// EL MODELO DE UNA MÉTRICA. De aquí cuelgan el semáforo, el tooltip y la jerarquía entera.
//
// POR QUÉ UN MODELO Y NO CARDS SUELTAS. Una tarjeta que solo lleva nombre y número obliga a que cada
// pantalla decida por su cuenta si ese número está bien, con qué comparar y qué significa. Eso es lo
// que produce dashboards donde el mismo KPI sale verde en una pantalla y rojo en otra.
//
// LA REGLA QUE MÁS IMPORTA: MÁS ALTO NO ES VERDE POR DEFECTO.
//
//   Revenue más alto     -> mejor
//   CAC más alto         -> PEOR
//   Churn más alto       -> PEOR
//   Close Rate más alto  -> mejor
//
// Por eso `higherIsBetter` es obligatorio en cada métrica y no tiene valor por defecto: olvidarlo
// tiene que ser un error de compilación, no un semáforo al revés que nadie mira dos veces.

import { formatCurrency, formatNumber } from '@/lib/utils'

/** Familias de la jerarquía, de lo final del negocio a lo diagnóstico. */
type CategoriaMetrica = 'global' | 'sales' | 'marketing' | 'product' | 'finance'

type SubcategoriaMetrica =
  'organic_instagram' | 'organic_tiktok' | 'organic_youtube' | 'paid_meta' | 'funnel' | 'delivery' | 'cash' | 'team'

type UnidadMetrica = 'eur' | 'porcentaje' | 'numero' | 'ratio' | 'dias' | 'minutos'

/**
 * `minimo` — el objetivo es un suelo (Close Rate ≥ 25%).
 * `maximo` — el objetivo es un techo (CAC ≤ 400€).
 * `rango` — hay banda buena por arriba y por abajo (Show Rate 65-70%).
 * `ninguno` — no hay objetivo declarado. La métrica se muestra sin semáforo, no en gris de alarma.
 */
type TipoObjetivo = 'minimo' | 'maximo' | 'rango' | 'ninguno'

/**
 * GREEN dentro o por encima del objetivo · YELLOW cerca, vigilar · RED claramente fuera ·
 * GRAY datos insuficientes o fuente sin conectar.
 *
 * GRAY NO ES ROJO. "No lo sabemos" y "va mal" llevan a decisiones opuestas: la primera se arregla
 * conectando una fuente, la segunda cambiando el negocio.
 */
export type EstadoSemaforo = 'verde' | 'amarillo' | 'rojo' | 'gris'

/**
 * De dónde sale el dato y cuánto fiarse. La jerarquía la fija el negocio por tipo de dato (dinero
 * cobrado: pasarela > contabilidad > CRM > manual), y aquí se declara qué eslabón se está usando.
 */
export type Fiabilidad = 'alta' | 'media' | 'baja'

/** Estado del dato en sí, separado del semáforo de rendimiento. Un hueco nunca es un cero. */
export type EstadoDato = 'ok' | 'sin_datos' | 'fuente_no_conectada' | 'no_medido' | 'parcial' | 'error'

type TipoGrafico = 'barras' | 'linea' | 'area' | 'embudo' | 'ninguno'

type Granularidad = 'dia' | 'semana' | 'mes'

/** La DEFINICIÓN de una métrica: lo que no cambia con el periodo ni con los datos. */
export type DefinicionMetrica = {
  id: string
  /** Clave estable para URLs y configuración. No se renombra a la ligera. */
  key: string
  name: string
  /** Para tablas y ejes estrechos, donde el nombre largo no cabe. */
  shortName: string
  category: CategoriaMetrica
  subcategory?: SubcategoriaMetrica
  unit: UnidadMetrica
  /** La fórmula, legible por una persona. Va tal cual en el tooltip. */
  formula: string
  /** Qué es, en una frase que entienda alguien sin formación financiera. */
  description: string
  /** Por qué importa para el negocio. Una o dos frases. */
  whyItMatters: string
  dataSource: string
  /** De dónde se tira si la fuente principal no está. Vacío cuando no hay alternativa honesta. */
  fallbackDataSource?: string
  /** OBLIGATORIO y sin valor por defecto: es lo que evita el semáforo al revés. */
  higherIsBetter: boolean
  targetType: TipoObjetivo
  target?: number
  targetMin?: number
  targetMax?: number
  /**
   * Margen alrededor del objetivo que se considera "cerca" (amarillo), como fracción. 0.1 = 10%.
   * Sin esto, un CAC de 401€ contra un objetivo de 400€ saldría rojo, que es ruido, no señal.
   */
  tolerancia?: number
  recommendedChart: TipoGrafico
  timeGranularity: Granularidad[]
  /** Métricas de las que depende cuando es calculada. Sirve para explicar un hueco aguas arriba. */
  calculationDependencies?: string[]
}

/** La MEDICIÓN: la definición ya resuelta contra un periodo y unos datos. */
export type MetricaMedida = DefinicionMetrica & {
  value: number | null
  previousValue: number | null
  absoluteChange: number | null
  percentageChange: number | null
  status: EstadoSemaforo
  estadoDato: EstadoDato
  dataReliability: Fiabilidad
  lastUpdatedAt: string | null
  isCalculated: boolean
  /** Por qué el dato está como está, cuando no es `ok`. Va al tooltip. */
  notaDato?: string
}

/**
 * El semáforo. Se calcula aquí y en ningún otro sitio, para que el mismo valor no salga verde en una
 * pantalla y ámbar en otra.
 *
 * ORDEN DE LAS COMPROBACIONES, y es deliberado:
 *
 * 1. Sin dato → GRIS. Antes que nada: un valor nulo no puede compararse con un objetivo, y pintarlo
 *    rojo diría "vamos mal" cuando lo cierto es "no lo sabemos".
 * 2. Sin objetivo → GRIS sin alarma. La métrica se enseña, pero no se finge un juicio que nadie ha
 *    declarado. Inventar un benchmark de internet y pintarlo rojo es peor que no pintar nada.
 * 3. Con objetivo → verde / amarillo / rojo según `higherIsBetter` y el tipo de objetivo.
 */
export function calcularEstado(
  def: Pick<DefinicionMetrica, 'higherIsBetter' | 'targetType' | 'target' | 'targetMin' | 'targetMax' | 'tolerancia'>,
  value: number | null,
  estadoDato: EstadoDato = 'ok'
): EstadoSemaforo {
  if (value === null || !Number.isFinite(value) || estadoDato !== 'ok') return 'gris'
  if (def.targetType === 'ninguno') return 'gris'

  const tol = def.tolerancia ?? 0.1

  if (def.targetType === 'rango') {
    const { targetMin, targetMax } = def
    if (targetMin === undefined || targetMax === undefined) return 'gris'
    if (value >= targetMin && value <= targetMax) return 'verde'
    // Fuera de la banda pero dentro del margen: vigilar, no alarmar.
    const margen = (targetMax - targetMin) * tol
    if (value >= targetMin - margen && value <= targetMax + margen) return 'amarillo'
    return 'rojo'
  }

  const objetivo = def.target
  if (objetivo === undefined) return 'gris'
  const margen = Math.abs(objetivo) * tol

  // `minimo`: el objetivo es un suelo. Cumple quien lo alcanza o lo supera.
  if (def.targetType === 'minimo') {
    if (value >= objetivo) return 'verde'
    if (value >= objetivo - margen) return 'amarillo'
    return 'rojo'
  }

  // `maximo`: el objetivo es un techo. Aquí es donde `higherIsBetter: false` cobra sentido —CAC,
  // churn, coste por agenda—: quedarse POR DEBAJO es lo bueno.
  if (value <= objetivo) return 'verde'
  if (value <= objetivo + margen) return 'amarillo'
  return 'rojo'
}

/**
 * La variación contra el periodo anterior.
 *
 * `percentageChange` es `null` cuando el periodo anterior vale 0: dividir entre cero daría Infinity, y
 * pintar "+∞%" o "+100%" al pasar de 0 a 3 ventas no informa de nada. El cambio absoluto sí se da,
 * que es lo que de verdad se puede leer ahí.
 */
export function calcularVariacion(
  value: number | null,
  previousValue: number | null
): { absoluteChange: number | null; percentageChange: number | null } {
  if (value === null || previousValue === null || !Number.isFinite(value) || !Number.isFinite(previousValue)) {
    return { absoluteChange: null, percentageChange: null }
  }
  const absoluteChange = value - previousValue
  if (previousValue === 0) return { absoluteChange, percentageChange: null }
  return { absoluteChange, percentageChange: (absoluteChange / Math.abs(previousValue)) * 100 }
}

/**
 * ¿Esta variación es una buena noticia?
 *
 * Separado del signo a propósito: un CAC que baja un 20% es una variación NEGATIVA y una noticia
 * BUENA. Pintar de rojo toda flecha hacia abajo es el error más común de estos paneles.
 *
 * `null` cuando no hay variación que juzgar o cuando el cambio es cero.
 */
export function esMejora(higherIsBetter: boolean, absoluteChange: number | null): boolean | null {
  if (absoluteChange === null || absoluteChange === 0) return null
  return higherIsBetter ? absoluteChange > 0 : absoluteChange < 0
}

/** Une definición, valores y estado en la métrica lista para pintar. */
export function medir(
  def: DefinicionMetrica,
  datos: {
    value: number | null
    previousValue?: number | null
    estadoDato?: EstadoDato
    dataReliability?: Fiabilidad
    lastUpdatedAt?: string | null
    isCalculated?: boolean
    notaDato?: string
  }
): MetricaMedida {
  const estadoDato = datos.estadoDato ?? (datos.value === null ? 'sin_datos' : 'ok')
  const previousValue = datos.previousValue ?? null
  const { absoluteChange, percentageChange } = calcularVariacion(datos.value, previousValue)

  return {
    ...def,
    value: datos.value,
    previousValue,
    absoluteChange,
    percentageChange,
    status: calcularEstado(def, datos.value, estadoDato),
    estadoDato,
    // Sin fuente conectada la fiabilidad no puede ser alta, diga lo que diga quien la declaró.
    dataReliability: estadoDato === 'ok' ? (datos.dataReliability ?? 'media') : 'baja',
    lastUpdatedAt: datos.lastUpdatedAt ?? null,
    isCalculated: datos.isCalculated ?? false,
    notaDato: datos.notaDato,
  }
}

/** El texto del objetivo para el tooltip. `null` cuando no hay objetivo declarado. */
export function textoObjetivo(def: DefinicionMetrica): string | null {
  const fmt = (n: number) =>
    def.unit === 'eur' ? formatCurrency(n) : def.unit === 'porcentaje' ? `${formatNumber(n)}%` : formatNumber(n)
  switch (def.targetType) {
    case 'minimo':
      return def.target === undefined ? null : `≥ ${fmt(def.target)}`
    case 'maximo':
      return def.target === undefined ? null : `≤ ${fmt(def.target)}`
    case 'rango':
      return def.targetMin === undefined || def.targetMax === undefined
        ? null
        : `${fmt(def.targetMin)} – ${fmt(def.targetMax)}`
    default:
      return null
  }
}
