// BUSINESS HEALTH: un número, pero NUNCA un número opaco.
//
// El requisito del negocio es explícito: la salud tiene que poder descomponerse. Un "78/100" que nadie
// puede auditar es peor que no tener nota, porque se usa para decidir y no se puede discutir. Aquí todo
// resultado arrastra sus componentes, el peso de cada uno, lo que aportó y qué faltaba por medir.
//
// CINCO DIMENSIONES, y se calculan por separado porque se arreglan por separado:
//
//   ADQUISICIÓN   — ¿entra suficiente oportunidad y a qué coste?
//   VENTAS        — ¿se convierte lo que entra?
//   PRODUCTO      — ¿se queda el cliente y paga lo comprometido?
//   FINANCIERA    — ¿la unidad económica aguanta?  (LTGP:CAC, Cash ROAS, margen)
//   CAPACIDAD     — ¿hay techo operativo?
//
// TRES REGLAS QUE NO SE NEGOCIAN
//
// 1. FALTA DE DATO NO ES UN CERO. Una dimensión sin datos vale `null`, no 0. Puntuar con ceros lo que no
//    se mide produce una salud catastrófica de un negocio sano, y al revés en cuanto alguien "arregla"
//    la métrica rellenándola a mano.
// 2. EL PESO SE RENORMALIZA sobre lo que sí se ha medido, y se declara la cobertura. Un 82 sobre dos de
//    cinco dimensiones no es el mismo 82 que sobre cinco.
// 3. NO SE INVENTA PRECISIÓN. Se redondea a entero y se etiqueta la fiabilidad por cobertura y muestra.

import type { EntradaMetrica } from './cuello-botella'

export type DimensionSalud = 'adquisicion' | 'ventas' | 'producto' | 'financiera' | 'capacidad'

export const NOMBRE_DIMENSION: Record<DimensionSalud, string> = {
  adquisicion: 'Adquisición',
  ventas: 'Ventas',
  producto: 'Producto y retención',
  financiera: 'Economía unitaria',
  capacidad: 'Capacidad operativa',
}

/**
 * Pesos por dimensión. La economía unitaria pesa más que el resto porque es la que decide si crecer
 * suma o resta: un funnel impecable con LTGP:CAC de 1,2 es una máquina de perder dinero más rápido.
 */
export const PESO_DIMENSION: Record<DimensionSalud, number> = {
  financiera: 0.3,
  ventas: 0.25,
  adquisicion: 0.2,
  producto: 0.15,
  capacidad: 0.1,
}

export type Fiabilidad = 'alta' | 'media' | 'baja'

/** Lo que aportó UNA métrica a su dimensión. Esto es lo que hace auditable la nota. */
export type ComponenteSalud = {
  key: string
  nombre: string
  actual: number | null
  objetivo: number | null
  /** 0-100, o `null` si no hay dato con el que puntuar. */
  puntos: number | null
  muestra: number | null
  /** Cómo se convirtió la métrica en puntos, literal para la UI. */
  explicacion: string
}

export type SubscoreSalud = {
  dimension: DimensionSalud
  nombre: string
  /** 0-100 o `null` cuando ninguna de sus métricas tiene dato. Nunca 0 por falta de datos. */
  puntuacion: number | null
  peso: number
  componentes: ComponenteSalud[]
  /** Fracción de componentes con dato (0-1). */
  cobertura: number
  fiabilidad: Fiabilidad
}

export type SaludNegocio = {
  /** 0-100 o `null` si no hay base suficiente para dar una nota. */
  puntuacion: number | null
  etiqueta: 'saludable' | 'aceptable' | 'en_riesgo' | 'critico' | 'sin_datos'
  subscores: SubscoreSalud[]
  /** Fracción del peso total que sí se ha podido medir (0-1). */
  coberturaPeso: number
  fiabilidad: Fiabilidad
  /** La dimensión medida con peor nota. Es por donde mirar, y coincide con el motor de cuello de botella. */
  peor: DimensionSalud | null
  /** Dimensiones sin ninguna métrica medida. Hueco de medición, no de negocio. */
  sinDatos: DimensionSalud[]
  titular: string
}

/**
 * Convierte una métrica en puntos 0-100.
 *
 * `ratio` = qué fracción del objetivo se cumple, ya orientada (1 = en objetivo). Para métricas de coste
 * se invierte: gastar la mitad del objetivo de CAC es un ratio de 2, no de 0,5.
 *
 * La escala arranca en la MITAD del objetivo. Un close rate que es el 10% de su objetivo y otro que es
 * el 45% están los dos rotos, y estirar la escala hasta el cero solo produce decimales sin significado.
 * Y se corta en 100: superar el objetivo tres veces no compensa otra dimensión rota.
 */
const SUELO_ESCALA = 0.5

export function puntuarRatio(ratio: number): number {
  const bruto = ((ratio - SUELO_ESCALA) / (1 - SUELO_ESCALA)) * 100
  return Math.max(0, Math.min(100, Math.round(bruto)))
}

function ratioDe(m: EntradaMetrica): number | null {
  if (m.valor === null || m.objetivo === null) return null
  if (m.higherIsBetter) {
    if (m.objetivo === 0) return null
    return m.valor / m.objetivo
  }
  // Métrica de coste: el objetivo es un techo. Valor 0 con techo 500 es perfecto, no una división por cero.
  if (m.valor === 0) return 2
  if (m.objetivo === 0) return null
  return m.objetivo / m.valor
}

function componente(m: EntradaMetrica): ComponenteSalud {
  const ratio = ratioDe(m)
  const puntos = ratio === null ? null : puntuarRatio(ratio)
  return {
    key: m.key,
    nombre: m.nombre,
    actual: m.valor,
    objetivo: m.objetivo,
    puntos,
    muestra: m.muestra,
    explicacion:
      ratio === null
        ? m.valor === null
          ? 'Sin datos medidos todavía: no puntúa (no cuenta como cero).'
          : 'Sin objetivo definido: no puntúa.'
        : `${m.valor} frente a un objetivo de ${m.objetivo} → ${Math.round(ratio * 100)}% del objetivo → ${puntos}/100.`,
  }
}

function fiabilidadPor(cobertura: number, muestras: (number | null)[]): Fiabilidad {
  const conMuestra = muestras.filter((x): x is number => x !== null)
  const minima = conMuestra.length > 0 ? Math.min(...conMuestra) : 0
  if (cobertura >= 0.8 && minima >= 100) return 'alta'
  if (cobertura >= 0.5 && minima >= 20) return 'media'
  return 'baja'
}

/** Puntúa una dimensión a partir de sus métricas. Sin métricas con dato, `null`. */
export function calcularSubscore(dimension: DimensionSalud, metricas: EntradaMetrica[]): SubscoreSalud {
  const componentes = metricas.map(componente)
  const puntuables = componentes.filter((c) => c.puntos !== null)
  const cobertura = componentes.length === 0 ? 0 : puntuables.length / componentes.length
  return {
    dimension,
    nombre: NOMBRE_DIMENSION[dimension],
    // Media simple entre los componentes CON dato: dentro de una dimensión no hay jerarquía que
    // justifique pesos distintos, y inventarlos haría la nota más difícil de discutir sin ser mejor.
    puntuacion:
      puntuables.length === 0
        ? null
        : Math.round(puntuables.reduce((a, c) => a + (c.puntos ?? 0), 0) / puntuables.length),
    peso: PESO_DIMENSION[dimension],
    componentes,
    cobertura,
    fiabilidad: fiabilidadPor(
      cobertura,
      puntuables.map((c) => c.muestra)
    ),
  }
}

function etiquetaPor(puntuacion: number | null): SaludNegocio['etiqueta'] {
  if (puntuacion === null) return 'sin_datos'
  if (puntuacion >= 80) return 'saludable'
  if (puntuacion >= 60) return 'aceptable'
  if (puntuacion >= 40) return 'en_riesgo'
  return 'critico'
}

/**
 * La salud del negocio a partir de las métricas agrupadas por dimensión.
 *
 * Se exige al menos DOS dimensiones medidas para dar una nota global. Con una sola, lo que sale no es la
 * salud del negocio: es esa dimensión con otro nombre, y presentarla como salud engaña.
 */
export const MINIMO_DIMENSIONES = 2

export function calcularSalud(porDimension: Partial<Record<DimensionSalud, EntradaMetrica[]>>): SaludNegocio {
  const dimensiones = Object.keys(PESO_DIMENSION) as DimensionSalud[]
  const subscores = dimensiones
    .filter((d) => porDimension[d] !== undefined)
    .map((d) => calcularSubscore(d, porDimension[d] ?? []))

  const medidos = subscores.filter((s) => s.puntuacion !== null)
  const sinDatos = subscores.filter((s) => s.puntuacion === null).map((s) => s.dimension)

  const pesoTotal = dimensiones.reduce((a, d) => a + PESO_DIMENSION[d], 0)
  const pesoMedido = medidos.reduce((a, s) => a + s.peso, 0)
  const coberturaPeso = pesoTotal === 0 ? 0 : pesoMedido / pesoTotal

  // El peso se renormaliza sobre lo medido. Repartir el peso de una dimensión ausente entre las demás
  // es lo único honesto: la alternativa es tratarla como un cero.
  const puntuacion =
    medidos.length < MINIMO_DIMENSIONES || pesoMedido === 0
      ? null
      : Math.round(medidos.reduce((a, s) => a + (s.puntuacion ?? 0) * s.peso, 0) / pesoMedido)

  const peor =
    medidos.length === 0
      ? null
      : medidos.reduce((a, s) => ((s.puntuacion ?? 100) < (a.puntuacion ?? 100) ? s : a)).dimension

  const fiabilidad: Fiabilidad =
    puntuacion === null
      ? 'baja'
      : coberturaPeso >= 0.8 && medidos.every((s) => s.fiabilidad === 'alta')
        ? 'alta'
        : coberturaPeso >= 0.5 && medidos.some((s) => s.fiabilidad !== 'baja')
          ? 'media'
          : 'baja'

  return {
    puntuacion,
    etiqueta: etiquetaPor(puntuacion),
    subscores,
    coberturaPeso,
    fiabilidad,
    peor,
    sinDatos,
    titular: redactarTitularSalud(puntuacion, coberturaPeso, peor, sinDatos),
  }
}

function redactarTitularSalud(
  puntuacion: number | null,
  coberturaPeso: number,
  peor: DimensionSalud | null,
  sinDatos: DimensionSalud[]
): string {
  if (puntuacion === null) {
    return `Aún no hay base para una nota de salud: faltan datos en ${sinDatos.length || 'todas las'} dimensiones.`
  }
  const cobertura = `sobre el ${Math.round(coberturaPeso * 100)}% del negocio medido`
  const arrastre = peor ? ` Lo que más arrastra: ${NOMBRE_DIMENSION[peor]}.` : ''
  return `${puntuacion}/100 ${cobertura}.${arrastre}`
}
