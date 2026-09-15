// ALERTAS Y ANOMALÍAS. Lo difícil de un sistema de alertas no es detectar: es CALLARSE.
//
// Un panel que avisa de doce cosas cada mañana se ignora en tres días, y entonces no avisa de nada. Por
// eso aquí hay un máximo duro de prioridades y todo lo demás queda listado pero fuera del foco.
//
// CUATRO CATEGORÍAS, porque se atienden de forma distinta:
//   KPI          — una métrica ha cruzado su umbral. Acción de negocio.
//   ANOMALIA     — un dato se ha salido de su comportamiento habitual. Puede ser buena noticia.
//   CAPACIDAD    — techo operativo cerca. No se arregla optimizando, se arregla contratando.
//   CALIDAD_DATO — el sistema no está midiendo algo. NO es un problema de negocio, y confundirlo con
//                  uno manda al equipo a arreglar un número que nadie ha medido.
//
// LA REGLA DE LA MUESTRA, otra vez: no se detecta anomalía sin histórico suficiente. Con tres
// observaciones, cualquier cuarto valor es "anómalo" y la alerta es ruido con formato.
//
// SE USA LA MAD, NO LA DESVIACIÓN TÍPICA. La desviación típica la infla el propio valor extremo que se
// quiere detectar: un día con 10x de gasto sube sigma tanto que el día deja de parecer raro. La mediana
// de desviaciones absolutas no se deja arrastrar por un punto.

type CategoriaAlerta = 'KPI' | 'ANOMALIA' | 'CAPACIDAD' | 'CALIDAD_DATO'

type SeveridadAlerta = 'INFO' | 'WARNING' | 'CRITICAL'

export type Alerta = {
  id: string
  categoria: CategoriaAlerta
  severidad: SeveridadAlerta
  titulo: string
  /** Qué ha pasado, con los números. */
  detalle: string
  /** Qué mirar. Vacío es aceptable en CALIDAD_DATO, donde la acción es medir. */
  accion: string | null
  metricaKey: string | null
  /** `true` cuando la desviación es a mejor: un pico de ventas también es una anomalía, y buena. */
  favorable: boolean
}

/** Máximo de alertas en el foco. Más que esto y el panel deja de ser un aviso y pasa a ser un muro. */
export const MAXIMO_PRIORIDADES = 3

const ORDEN_SEVERIDAD: Record<SeveridadAlerta, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }
// Con la misma severidad manda lo que mueve dinero. La calidad de dato va última porque es importante
// y nunca urgente: no se arregla hoy y no cambia la decisión de hoy.
const ORDEN_CATEGORIA: Record<CategoriaAlerta, number> = { KPI: 0, CAPACIDAD: 1, ANOMALIA: 2, CALIDAD_DATO: 3 }

export function ordenarAlertas(alertas: Alerta[]): Alerta[] {
  return [...alertas].sort((a, b) => {
    // Una anomalía favorable nunca adelanta a un problema: es interesante, no urgente.
    if (a.favorable !== b.favorable) return a.favorable ? 1 : -1
    const s = ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad]
    if (s !== 0) return s
    return ORDEN_CATEGORIA[a.categoria] - ORDEN_CATEGORIA[b.categoria]
  })
}

export function priorizar(alertas: Alerta[]): { prioridades: Alerta[]; resto: Alerta[] } {
  const ordenadas = ordenarAlertas(alertas)
  return { prioridades: ordenadas.slice(0, MAXIMO_PRIORIDADES), resto: ordenadas.slice(MAXIMO_PRIORIDADES) }
}

// ---------------------------------------------------------------------------------------------
// DETECCIÓN DE ANOMALÍAS
// ---------------------------------------------------------------------------------------------

/** Mínimo de observaciones históricas para poder hablar de anomalía. */
export const MINIMO_HISTORICO = 7

/** Umbral en MAD normalizadas. 3,5 es el criterio habitual del z-score modificado. */
export const UMBRAL_ANOMALIA = 3.5

/** Constante que hace la MAD comparable a una desviación típica en una normal. */
const ESCALA_MAD = 0.6745

function mediana(valores: number[]): number {
  const o = [...valores].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 === 0 ? (o[m - 1] + o[m]) / 2 : o[m]
}

export type Anomalia = {
  esAnomalia: boolean
  /** z-score modificado. `null` cuando no se puede calcular. */
  puntuacion: number | null
  mediana: number
  mad: number
  favorable: boolean | null
  motivo: string
}

/**
 * ¿Es `valor` anómalo respecto de `historico`?
 *
 * `historico` NO debe incluir el valor que se está evaluando: incluirlo desplaza la mediana hacia él y
 * hace que un valor extremo se juzgue contra un centro que él mismo ha movido.
 */
export function detectarAnomalia(
  valor: number,
  historico: number[],
  opciones: { higherIsBetter?: boolean } = {}
): Anomalia | null {
  if (historico.length < MINIMO_HISTORICO) return null

  const med = mediana(historico)
  const mad = mediana(historico.map((v) => Math.abs(v - med)))
  const desviacion = valor - med

  if (mad === 0) {
    // Histórico constante. Cualquier cambio es infinitamente raro en términos de MAD, lo cual es cierto
    // pero inútil como puntuación: se declara anomalía sin número y se dice por qué.
    const distinto = desviacion !== 0
    return {
      esAnomalia: distinto,
      puntuacion: null,
      mediana: med,
      mad: 0,
      favorable: distinto && opciones.higherIsBetter !== undefined ? desviacion > 0 === opciones.higherIsBetter : null,
      motivo: distinto
        ? `El histórico era constante en ${med} y este valor es ${valor}: es un cambio, pero sin variabilidad previa no se puede puntuar cuánto.`
        : `Idéntico al histórico constante (${med}).`,
    }
  }

  const puntuacion = Math.round(((ESCALA_MAD * desviacion) / mad) * 100) / 100
  const esAnomalia = Math.abs(puntuacion) >= UMBRAL_ANOMALIA
  const favorable = opciones.higherIsBetter === undefined ? null : desviacion > 0 === opciones.higherIsBetter

  return {
    esAnomalia,
    puntuacion,
    mediana: med,
    mad: Math.round(mad * 100) / 100,
    favorable,
    motivo: esAnomalia
      ? `${valor} frente a una mediana histórica de ${med} (${historico.length} observaciones): se desvía ${Math.abs(puntuacion)} MAD, por encima del umbral de ${UMBRAL_ANOMALIA}.`
      : `${valor} está dentro de lo habitual (mediana ${med}, desvío ${Math.abs(puntuacion)} MAD).`,
  }
}

// ---------------------------------------------------------------------------------------------
// CONSTRUCTORES. Existen para que el texto de cada clase de alerta se escriba UNA vez y no lo redacte
// cada pantalla a su manera.
// ---------------------------------------------------------------------------------------------

export function alertaKpi(args: {
  key: string
  nombre: string
  valor: number
  objetivo: number
  higherIsBetter: boolean
  desvioRelativo: number
  muestra: number | null
  investigar?: string[]
}): Alerta {
  const critico = args.desvioRelativo >= 0.2
  return {
    id: `kpi:${args.key}`,
    categoria: 'KPI',
    severidad: critico ? 'CRITICAL' : 'WARNING',
    titulo: `${args.nombre} fuera de objetivo`,
    detalle: `${args.valor} frente a un objetivo de ${args.objetivo} (${Math.round(args.desvioRelativo * 100)}% ${args.higherIsBetter ? 'por debajo' : 'por encima'})${args.muestra !== null ? `, sobre ${args.muestra} observaciones` : ''}.`,
    accion: args.investigar?.[0] ?? null,
    metricaKey: args.key,
    favorable: false,
  }
}

export function alertaAnomalia(args: { key: string; nombre: string; valor: number; anomalia: Anomalia }): Alerta {
  const favorable = args.anomalia.favorable === true
  return {
    id: `anomalia:${args.key}`,
    categoria: 'ANOMALIA',
    // Una anomalía es INFO cuando es favorable: se enseña, no se dispara.
    severidad: favorable ? 'INFO' : 'WARNING',
    titulo: `${args.nombre}: comportamiento inusual${favorable ? ' (a mejor)' : ''}`,
    detalle: args.anomalia.motivo,
    accion: favorable
      ? 'Mirar qué ha cambiado para poder repetirlo.'
      : 'Comprobar si es un cambio real o un fallo de ingesta.',
    metricaKey: args.key,
    favorable,
  }
}

export function alertaCapacidad(args: { area: string; utilizacion: number }): Alerta {
  return {
    id: `capacidad:${args.area}`,
    categoria: 'CAPACIDAD',
    severidad: args.utilizacion >= 90 ? 'CRITICAL' : 'WARNING',
    titulo: `${args.area} cerca del techo de capacidad`,
    detalle: `Utilización del ${args.utilizacion}%. Esto no se arregla optimizando conversión: es capacidad.`,
    accion: 'Decidir si se amplía capacidad antes de meter más volumen.',
    metricaKey: null,
    favorable: false,
  }
}

/**
 * Alerta de calidad de dato. Es la única categoría que NO afirma nada del negocio: dice que el sistema
 * no está midiendo algo, y por eso su severidad tope es WARNING aunque falte todo.
 */
export function alertaCalidadDato(args: { key: string; que: string; detalle: string; comoArreglar?: string }): Alerta {
  return {
    id: `dato:${args.key}`,
    categoria: 'CALIDAD_DATO',
    severidad: 'WARNING',
    titulo: `Falta medir: ${args.que}`,
    detalle: `${args.detalle} Mientras no se mida, las métricas que dependen de esto no se cuentan (no se rellenan con ceros).`,
    accion: args.comoArreglar ?? null,
    metricaKey: args.key,
    favorable: false,
  }
}
