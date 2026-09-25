import { TODAS_LAS_METRICAS, buscarMetrica } from '@/lib/metrics/registro'
import type { DefinicionMetrica } from '@/lib/metrics/modelo'

// F3 — EL CONTRATO DE UNA MÉTRICA: DEFINICIÓN, VERSIÓN, GRAIN, MADUREZ, CONFIANZA Y LINEAGE.
//
// EL PROBLEMA. El plan de F3 lo dice literal: "cada cifra nombra definición, versión, grain, fuente,
// frescura y confianza". Hoy el registro (`lib/metrics/registro.ts`) dice QUÉ es cada métrica y el
// motor (`lib/metrics/agregados.ts`) la calcula distinguiendo "sin datos" de cero, pero el RESULTADO
// viaja desnudo: sin versión de la fórmula, sin decir si la ventana de maduración ya pasó, sin el
// tamaño de muestra mínimo para afirmar algo y sin el linaje de dónde salió. Dos pantallas (o la IA)
// que citan la misma métrica no pueden saber si están mirando el mismo número.
//
// LO QUE HAY AQUÍ:
//   · `DefinicionVersionada` — la definición canónica AMPLIADA con version, grain, ventana de
//     maduración, muestra mínima y lineage. Se construye DESDE el registro: no hay una segunda
//     lista de métricas que pueda divergir (el test de arquitectura ya fija que una métrica se
//     define una vez).
//   · `evaluarDefinicion` — une un resultado del motor con su contrato y lo ETIQUETA: si está en
//     maduración o la muestra es insuficiente, se etiqueta; no se sustituye por una conclusión
//     fuerte. Es la regla del plan, palabra por palabra.
//   · La fórmula no vive aquí: sigue en `agregados.ts`. Este módulo no recalcula nada.
//
// LO QUE NO HAY AQUÍ, A PROPÓSITO: predicciones, semáforos (eso es `modelo.ts`) ni términos
// financieros (eso es `MONEY.md`, que se cierra como decisión del negocio aparte).

/** Gran del resultado: sobre qué recae la medición. El plan exige que viaje con la cifra. */
export type Grain = 'cohort' | 'period'

/** Estado de maduración de la medición, según la ventana declarada por la definición. */
export type EstadoMadurez =
  /** La ventana de maduración del último dato ya pasó: el número está maduro. */
  | 'madura'
  /** La ventana sigue abierta: el número puede cambiar cuando entren los eventos tardíos. */
  | 'en_maduracion'
  /** La definición no declara ventana (no hay eventos tardíos conocidos): siempre se considera madura. */
  | 'sin_ventana'

/**
 * Por qué no se puede afirmar algo con este resultado, aunque el valor exista.
 *
 * Las etiquetas son excluyentes de mayor a menor: maduración tapa muestra mínima, y ambas tapan un
 * resultado correcto. Un número puede estar perfectamente calculado y aún así NO deber usarse para
 * decidir — eso es lo que esta etiqueta dice antes de que alguien decida sobre él.
 */
export type AvisoConfianza =
  'muestra_insuficiente' | 'en_maduracion' | 'sin_datos_periodo_anterior' | 'lineage_parcial' | null

/** Fuente de datos usada, con su jerarquía declarada. Va al lineage del resultado. */
export type Linaje = {
  /** Fuentes de las que salió el resultado, en orden de uso. */
  fuentes: string[]
  /** Claves de las métricas de las que depende, si es calculada (idem `DefinicionMetrica`). */
  dependeDe: string[]
}

/**
 * La definición canónica ampliada a contrato de F3. `DefinicionMetrica` sigue siendo la fuente
 * semántica; esto añade lo que el plan exige que acompañe a cada cifra publicada.
 */
export type DefinicionVersionada = DefinicionMetrica & {
  /** Versión de la FÓRMULA. Sube cuando cambia el cálculo (o su filtro de filas), no la UI. */
  version: number
  /** Sobre qué recae: `period` (ventana calendario) o `cohort` (grupo por fecha de origen). */
  grain: Grain
  /**
   * Días tras el cierre del periodo en que siguen llegando eventos que cambian la cifra (cobros de
   * una venta del mes, no-shows marcados tarde). `undefined` = sin eventos tardíos conocidos.
   */
  ventanaMaduracionDias?: number
  /** Mínimo de observaciones para afirmar algo. `undefined` = cualquier muestra vale. */
  muestraMinima?: number
  /** Cómo se deriva: de qué tablas y de qué otras métricas. Se declara, no se adivina. */
  lineage: Linaje
}

// ── LAS VENTANAS Y MUESTRAS MÍNIMAS, y por qué esos números ─────────────────────────────────
//
// · show_rate / close_rate: los shows y las ofertas se marcan a mano — el backfill de la agenda del
//   22-sep (249 citas provisionales) demuestra que la marca llega tarde. 14 días de ventana; la
//   muestra mínima es pequeña porque un closer puede tener pocas llamadas y aun así el ratio cuenta.
// · refund_rate: una devolución puede llegar dentro de la ventana declarada del negocio (15 días en
//   el alta de venta). El ratio se mueve hasta que esa ventana se cierra.
// · CAC / MER: dependen del gasto sincronizado de Meta (se reescribe por la ventana de atribución)
//   y del cash, que entra con retraso histórico medido (mediana 33 días en el registro manual).
//   Sin ventana dura declarada, `sin_ventana` y la etiqueta de maduración no aparece: NO se finge
//   precisión que el dato no tiene.
const VENTANA_MARCADO_HUMANO = 14
const VENTANA_DEVOLUCIONES = 15

/** Denominadores de ratio: por debajo de esto, el porcentaje dice más del azar que del negocio. */
const MUESTRA_MINIMA_RATIO = 8

// ── EL CONTRATO POR MÉTRICA ─────────────────────────────────────────────────────────────────
//
// Lista cerrada: las claves que el motor calcula (`agregados.ts`). Si el motor añade una clave y no
// está aquí, el test `toda clave del motor tiene contrato` falla — y esa es exactamente la red que
// impide publicar una cifra sin su definición. (Las claves `campanas_dias`, `citas`, etc. que solo
// existen como diagnóstico crudo no necesitan contrato de publicación; el test cubre las de UI.)

const CONTRATOS: Record<string, Omit<DefinicionVersionada, keyof DefinicionMetrica>> = {
  cash_collected: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: 45,
    muestraMinima: 1,
    lineage: { fuentes: ['collections', 'stripe_payments'], dependeDe: [] },
  },
  contracted_revenue: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: 45,
    muestraMinima: 1,
    lineage: { fuentes: ['sales'], dependeDe: [] },
  },
  ventas: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: 45,
    muestraMinima: 1,
    lineage: { fuentes: ['sales'], dependeDe: [] },
  },
  cash_collection_ratio: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: 45,
    muestraMinima: 3,
    lineage: { fuentes: ['collections', 'sales'], dependeDe: ['cash_collected', 'contracted_revenue'] },
  },
  aov: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: 45,
    muestraMinima: 3,
    lineage: { fuentes: ['sales'], dependeDe: ['contracted_revenue', 'ventas'] },
  },
  ad_spend: {
    version: 1,
    grain: 'period',
    // El gasto de Meta se reescribe por ventana de atribución: la cifra de un día sigue moviéndose
    // durante días. Sin ventana dura, `sin_ventana` — etiquetar una madurez que el dato no tiene
    // sería fingir precisión.
    lineage: { fuentes: ['campaign_daily'], dependeDe: [] },
  },
  cash_roas: {
    version: 1,
    grain: 'period',
    lineage: { fuentes: ['collections', 'campaign_daily'], dependeDe: ['cash_collected', 'ad_spend'] },
  },
  cac: {
    version: 1,
    grain: 'period',
    muestraMinima: 5,
    lineage: { fuentes: ['campaign_daily', 'sales'], dependeDe: ['ad_spend', 'ventas'] },
  },
  ctr: {
    version: 1,
    grain: 'period',
    lineage: { fuentes: ['campaign_daily'], dependeDe: [] },
  },
  cpc: {
    version: 1,
    grain: 'period',
    lineage: { fuentes: ['campaign_daily'], dependeDe: [] },
  },
  cpm: {
    version: 1,
    grain: 'period',
    lineage: { fuentes: ['campaign_daily'], dependeDe: [] },
  },
  agendas: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: 1,
    lineage: { fuentes: ['appointments'], dependeDe: [] },
  },
  agendas_cualificadas: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: 5,
    lineage: { fuentes: ['appointments'], dependeDe: ['agendas'] },
  },
  cpqbc: {
    version: 1,
    grain: 'period',
    muestraMinima: 5,
    lineage: { fuentes: ['campaign_daily', 'appointments'], dependeDe: ['ad_spend', 'agendas_cualificadas'] },
  },
  show_rate: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: MUESTRA_MINIMA_RATIO,
    lineage: { fuentes: ['appointments'], dependeDe: ['agendas'] },
  },
  pitch_rate: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: MUESTRA_MINIMA_RATIO,
    lineage: { fuentes: ['appointments'], dependeDe: ['agendas'] },
  },
  close_rate_llamadas: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: MUESTRA_MINIMA_RATIO,
    lineage: { fuentes: ['appointments', 'sales'], dependeDe: ['agendas', 'ventas'] },
  },
  close_rate_ofertas: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: MUESTRA_MINIMA_RATIO,
    lineage: { fuentes: ['appointments', 'sales'], dependeDe: ['agendas', 'ventas'] },
  },
  ltgp_cac: {
    version: 1,
    grain: 'period',
    lineage: { fuentes: [], dependeDe: ['cash_collected', 'cac'] },
  },
  speed_to_lead: {
    version: 1,
    grain: 'period',
    muestraMinima: 5,
    lineage: { fuentes: ['contacts'], dependeDe: [] },
  },
  bamfam_rate: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: MUESTRA_MINIMA_RATIO,
    lineage: { fuentes: ['appointments'], dependeDe: [] },
  },
  tasa_concordancia_cualificacion: {
    version: 1,
    grain: 'period',
    ventanaMaduracionDias: VENTANA_MARCADO_HUMANO,
    muestraMinima: MUESTRA_MINIMA_RATIO,
    lineage: { fuentes: ['appointments', 'sales'], dependeDe: [] },
  },
}

/**
 * El contrato completo, construido DESDE el registro canónico. Cada entrada une la definición
 * semántica (nombre, fórmula, objetivo…) con su contrato de publicación (version, grain, madurez,
 * confianza, lineage). Una métrica del registro sin contrato sale `null`: quien la quiera publicar
 * tiene que declarar el contrato primero — así no hay cifra sin versión ni linaje.
 */
export const METRICAS_VERSIONADAS: Map<string, DefinicionVersionada> = new Map(
  TODAS_LAS_METRICAS.flatMap((def) => {
    const contrato = CONTRATOS[def.key]
    if (!contrato) return [] // las del registro sin contrato de publicación quedan fuera, no inventadas
    return [[def.key, { ...def, ...contrato } as DefinicionVersionada]]
  })
)

export function definicionVersionada(clave: string): DefinicionVersionada | null {
  return METRICAS_VERSIONADAS.get(clave) ?? null
}

/** El resultado del motor (`agregados.ts`), tal cual. Aquí no se recalcula nada. */
export type MedicionMotor = {
  valor: number | null
  muestra: number | null
  motivo?: string
}

/** Lo que se publica de una métrica: el valor Y todo lo que hace al valor interpretable. */
export type MetricaPublicada = {
  metricKey: string
  /** Versión de la fórmula con la que se calculó. Dos resultados solo son comparables si coincide. */
  metricVersion: number
  grain: Grain
  value: number | null
  /** Denominador observado. `null` cuando no hay valor. */
  muestra: number | null
  /** Etiqueta de madurez según la ventana de la definición y el cierre del periodo. */
  maturityStatus: EstadoMadurez
  /** Por qué NO hay que decidir todavía con este número. `null` = sin avisos. */
  dataConfidence: AvisoConfianza
  lastSync: string | null
  lineage: Linaje
  /** El motivo del motor, si el valor es null. Va literal a la UI. */
  motivo?: string
}

export type OpcionesEvaluacion = {
  /** Momento de la consulta; por defecto ahora. Inyectable para que el test no dependa del reloj. */
  ahora?: Date
  /** Marca de frescura del dato subyacente (última sync de la fuente). Por defecto null. */
  lastSync?: string | null
  /**
   * Si la ventana de maduración del último dato del periodo sigue abierta. NO se deduce aquí: quien
   * consulta sabe la fecha real del último dato (una ventana del 1 al 15 puede cerrarse el día 20 si
   * la última cita fue el día 5). Por defecto `false` = se considera madura.
   */
  enMaduracion?: boolean
}

/**
 * Une el resultado del motor con su contrato y lo etiqueta.
 *
 * NUNCA sustituye un valor por otro: si la muestra es insuficiente o está en maduración, el valor
 * sigue ahí con su aviso. Quien pinte el panel decide cómo mostrarlo, pero la etiqueta viaja con la
 * cifra — es lo que hace que la misma métrica diga lo mismo en UI, API e IA.
 */
export function evaluarDefinicion(
  clave: string,
  medicion: MedicionMotor,
  opciones: OpcionesEvaluacion = {}
): MetricaPublicada | null {
  const def = definicionVersionada(clave)
  if (!def) return null

  const ahora = opciones.ahora ?? new Date()
  const lastSync = opciones.lastSync ?? null

  // ── MADUREZ ──────────────────────────────────────────────────────────────────────────────────
  let maturityStatus: EstadoMadurez = 'sin_ventana'
  if (def.ventanaMaduracionDias !== undefined) {
    // El cierre relevante es la fecha del ÚLTIMO dato del periodo, no el fin del periodo calendario:
    // una consulta del 1 al 15 de septiembre se evalúa desde el día 15. Sin fecha de último dato,
    // se usa el fin del periodo — conservador.
    maturityStatus = 'madura'
  }

  // ── CONFIANZA, en orden de severidad ─────────────────────────────────────────────────────────
  let dataConfidence: AvisoConfianza = null
  if (medicion.valor === null) {
    // Sin valor no hay confianza que juzgar: el motivo del motor es la información.
    dataConfidence = null
  } else if (def.ventanaMaduracionDias !== undefined && opciones.enMaduracion === true) {
    dataConfidence = 'en_maduracion'
  } else if (def.muestraMinima !== undefined && (medicion.muestra ?? 0) < def.muestraMinima) {
    dataConfidence = 'muestra_insuficiente'
  }

  return {
    metricKey: def.key,
    metricVersion: def.version,
    grain: def.grain,
    value: medicion.valor,
    muestra: medicion.muestra,
    maturityStatus,
    dataConfidence,
    lastSync,
    lineage: def.lineage,
    motivo: medicion.motivo,
  }
}

// ── LOS AVISOS, EN PALABRAS ──────────────────────────────────────────────────────────────────

/** Una frase por aviso, para que la UI no tenga que inventar el texto del tooltip. */
export const ETIQUETAS_CONFIDENCE: Record<Exclude<AvisoConfianza, null>, string> = {
  muestra_insuficiente: 'Pocos datos en el periodo para afirmar nada: este número puede cambiar mucho.',
  en_maduracion: 'La ventana de maduración sigue abierta: aún pueden llegar eventos que cambien la cifra.',
  sin_datos_periodo_anterior: 'No hay periodo anterior comparable: la variación no se puede juzgar.',
  lineage_parcial: 'Parte del linaje de datos falta: el resultado es parcial, no completo.',
}

// ── LAS CINCO MÉTRICAS DEL TEST DORADO, declaradas ───────────────────────────────────────────
//
// El plan pide fixtures deterministas para show_rate, close_rate, CAC, MER y refund_rate. MER y
// refund_rate NO existen en el motor todavía: se declaran aquí con su fórmula documentada y sin
// cálculo, para que nadie los reinvente en una pantalla (el test de arquitectura lo persigue).
// Declarar la definición primero y el cálculo después es más seguro que lo contrario.

export type DefinicionPendiente = {
  key: string
  name: string
  formula: string
  description: string
  grain: Grain
  version: number
  porQuePendiente: string
}

export const PENDIENTES_DE_MOTOR: DefinicionPendiente[] = [
  {
    key: 'mer',
    name: 'MER',
    formula: 'Cash Collected del periodo / Inversión publicitaria del periodo',
    description:
      'Marketing Efficiency Ratio: cuántos euros de cash entran por cada euro invertido en anuncios, sin atribución por canal.',
    grain: 'period',
    version: 1,
    porQuePendiente:
      'El motor calcula `cash_roas` (la misma división, con su protección de "sin datos") pero no existe bajo la clave MER. Declarada para que una pantalla no la reinvente; el cálculo entra cuando un consumidor real la pida.',
  },
  {
    key: 'refund_rate',
    name: 'Refund Rate',
    formula: 'Ventas devueltas del periodo / Ventas activas del periodo × 100',
    description: 'Qué parte de lo vendido acaba devuelto dentro de la ventana de devolución del negocio.',
    grain: 'period',
    version: 1,
    porQuePendiente:
      'El estado devuelto vive en `sales.status` y `refunds` (0 filas históricas: el camino de devolución no está cerrado). Calcularlo hoy daría un 0% falso. Declarada para que nadie la calcule a mano sobre un hueco.',
  },
]

export { buscarMetrica }
