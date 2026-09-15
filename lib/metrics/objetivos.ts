// OBJETIVO vs REAL, con ritmo. La pregunta que el panel tiene que contestar no es "¿cuánto llevo?" sino
// "¿voy a llegar?".
//
// LA DISTINCIÓN QUE CASI TODOS LOS PANELES SE SALTAN: hay métricas ACUMULATIVAS (facturación, cash,
// clientes nuevos, ventas) y métricas de TASA o NIVEL (close rate, CAC, show rate). Llevar 12.000 € el
// día 10 de un objetivo de 40.000 € es ir por delante; tener un close rate del 12% el día 10 de un
// objetivo del 25% no es "el 48% del objetivo": un close rate no se acumula. Dividir una tasa por lo
// transcurrido produce la métrica más engañosa posible, la que dice que vas bien porque el mes es joven.
//
// Y una regla de siempre en este repo: sin dato NO es cero. Un objetivo sin real medido se declara como
// hueco, no como 0% de consecución.

/** Qué clase de objetivo es, porque decide si el ritmo tiene sentido. */
export type ClaseObjetivo = 'acumulativa' | 'tasa'

export type PeriodoObjetivo = 'mes' | 'trimestre' | 'año' | 'permanente'

export type Objetivo = {
  key: string
  nombre: string
  periodo: PeriodoObjetivo
  clase: ClaseObjetivo
  valor: number
  higherIsBetter: boolean
  unidad?: string
}

export type Ritmo = 'por_delante' | 'en_linea' | 'por_detras'

export type Tendencia = 'mejora' | 'empeora' | 'plano' | 'sin_comparable'

export type ObjetivoMedido = {
  key: string
  nombre: string
  periodo: PeriodoObjetivo
  clase: ClaseObjetivo
  /** `null` = no medido. No es cero. */
  actual: number | null
  objetivo: number
  /** Positivo = por encima del objetivo, en unidades de la métrica. */
  brecha: number | null
  /** % de consecución. Para tasas es actual/objetivo; no se ajusta por lo transcurrido. */
  consecucion: number | null
  previo: number | null
  tendencia: Tendencia
  /**
   * Solo para acumulativas y con el periodo en curso: ¿va al ritmo necesario? `null` cuando la pregunta
   * no aplica (una tasa, un objetivo permanente, o un periodo ya cerrado).
   */
  ritmo: Ritmo | null
  /** Cierre proyectado a ritmo actual. Solo acumulativas. SIEMPRE es una proyección, no una promesa. */
  proyeccionCierre: number | null
  /** Lo que hay que hacer al día / por semana restante para llegar. Solo acumulativas. */
  faltaPorPeriodoRestante: number | null
  nota: string
}

/** Margen dentro del que se considera "en línea": ±5% del ritmo necesario. */
export const TOLERANCIA_RITMO = 0.05

export type EntradaObjetivo = {
  objetivo: Objetivo
  actual: number | null
  /** El mismo dato en el periodo anterior completo, para la tendencia. */
  previo?: number | null
  /**
   * Fracción del periodo ya transcurrida (0-1). Requerida para el ritmo de las acumulativas.
   * `null` o ausente = periodo cerrado o desconocido, y entonces no se calcula ritmo.
   */
  fraccionTranscurrida?: number | null
  /** Unidades de periodo que quedan (días, semanas…), para decir qué falta por unidad. */
  unidadesRestantes?: number | null
  nombreUnidadRestante?: string
}

function tendenciaDe(actual: number | null, previo: number | null | undefined, higherIsBetter: boolean): Tendencia {
  if (actual === null || previo === null || previo === undefined) return 'sin_comparable'
  if (actual === previo) return 'plano'
  const sube = actual > previo
  return sube === higherIsBetter ? 'mejora' : 'empeora'
}

export function medirObjetivo(e: EntradaObjetivo): ObjetivoMedido {
  const { objetivo: o } = e
  const actual = e.actual
  const previo = e.previo ?? null
  const fraccion = e.fraccionTranscurrida ?? null
  const enCurso = fraccion !== null && fraccion > 0 && fraccion < 1 && o.periodo !== 'permanente'
  const acumulativa = o.clase === 'acumulativa'

  const brecha = actual === null ? null : Math.round((actual - o.valor) * 100) / 100
  // La consecución de una métrica de coste se lee al revés: gastar 400 de un techo de 500 es un 125%
  // de cumplimiento, no un 80%.
  const consecucion =
    actual === null || o.valor === 0
      ? null
      : Math.round((o.higherIsBetter ? actual / o.valor : o.valor / actual) * 1000) / 10

  let ritmo: Ritmo | null = null
  let proyeccionCierre: number | null = null
  let faltaPorPeriodoRestante: number | null = null
  let nota: string

  if (actual === null) {
    nota = 'Sin datos medidos en este periodo: no se puede evaluar el objetivo (no cuenta como 0%).'
  } else if (!acumulativa) {
    // Una tasa no se proyecta dividiendo por lo transcurrido. Lo único honesto es compararla con su
    // objetivo y decir si la muestra del periodo ya da para afirmarlo (eso lo aporta quien la mide).
    nota = `Es una tasa: se compara directamente con el objetivo, sin ajustar por lo transcurrido del periodo.`
  } else if (!enCurso) {
    nota = 'Periodo cerrado o sin fracción transcurrida conocida: no se calcula ritmo ni proyección.'
  } else {
    const necesarioAhora = o.valor * fraccion
    proyeccionCierre = Math.round((actual / fraccion) * 100) / 100
    const margen = necesarioAhora * TOLERANCIA_RITMO
    ritmo =
      actual > necesarioAhora + margen ? 'por_delante' : actual < necesarioAhora - margen ? 'por_detras' : 'en_linea'
    const falta = Math.max(0, o.valor - actual)
    const restantes = e.unidadesRestantes ?? null
    faltaPorPeriodoRestante = restantes !== null && restantes > 0 ? Math.round((falta / restantes) * 100) / 100 : null
    const porUnidad =
      faltaPorPeriodoRestante !== null
        ? ` Faltan ${Math.round(falta)} y quedan ${restantes} ${e.nombreUnidadRestante ?? 'unidades'}: ${faltaPorPeriodoRestante} por ${(e.nombreUnidadRestante ?? 'unidad').replace(/s$/, '')}.`
        : ''
    // "Proyección" y no "previsión de cierre": se dice que sale de extrapolar el ritmo actual, que es
    // exactamente lo que es y lo que puede fallar.
    nota = `Al ritmo actual (${Math.round(fraccion * 100)}% del periodo transcurrido) el cierre proyectado es ${proyeccionCierre}.${porUnidad}`
  }

  return {
    key: o.key,
    nombre: o.nombre,
    periodo: o.periodo,
    clase: o.clase,
    actual,
    objetivo: o.valor,
    brecha,
    consecucion,
    previo,
    tendencia: tendenciaDe(actual, previo, o.higherIsBetter),
    ritmo,
    proyeccionCierre,
    faltaPorPeriodoRestante,
    nota,
  }
}

export function medirObjetivos(entradas: EntradaObjetivo[]): ObjetivoMedido[] {
  return entradas.map(medirObjetivo)
}

/** Resumen de una tabla de objetivos, para la cabecera del panel. */
export function resumirObjetivos(medidos: ObjetivoMedido[]): {
  total: number
  enObjetivo: number
  porDetras: number
  sinDatos: number
  titular: string
} {
  const sinDatos = medidos.filter((m) => m.actual === null).length
  const conDatos = medidos.filter((m) => m.actual !== null)
  const enObjetivo = conDatos.filter((m) => (m.consecucion ?? 0) >= 100).length
  const porDetras = conDatos.filter((m) => m.ritmo === 'por_detras').length
  const titular =
    conDatos.length === 0
      ? 'Aún no hay objetivos con datos medidos.'
      : `${enObjetivo} de ${conDatos.length} objetivos cumplidos${porDetras > 0 ? `, ${porDetras} por detrás del ritmo` : ''}${sinDatos > 0 ? `, ${sinDatos} sin datos` : ''}.`
  return { total: medidos.length, enObjetivo, porDetras, sinDatos, titular }
}
