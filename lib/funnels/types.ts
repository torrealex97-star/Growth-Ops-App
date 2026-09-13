// Tipos canónicos de la sección Funnels.
//
// La regla que gobierna todo este módulo: **una métrica nunca colapsa a 0 por un fallo de fuente.**
// Ya costó un falso "0 filas" en la cobertura de datos del agente de IA, y en una pantalla de
// funnels el mismo error se lee como "la campaña no convierte" cuando lo que pasa es que la
// integración está caída. Por eso cada valor lleva su estado y su procedencia.

export type FunnelSource =
  | 'vsl' // eventos del player VSL (lib/vsl + tracking)
  | 'meta' // campaigns / campaign_daily sincronizados de Meta Ads
  | 'crm' // contacts / appointments / sales de la propia base
  | 'ga4' // Google Analytics 4 (Data API)
  | 'clarity' // Microsoft Clarity — ver LIMITED_SOURCES

export type MetricStatus =
  | 'ok' // hay dato y es de fiar
  | 'sin_datos' // la fuente respondió, pero no hay filas en el rango: un 0 legítimo
  | 'error_fuente' // no se pudo leer la fuente: el valor es DESCONOCIDO, no 0
  // La fuente no está conectada o le falta el mapeo que esta etapa necesita. NO es un fallo (no
  // hay nada roto que arreglar) ni un 0 (no sabemos cuánto es): es trabajo de configuración
  // pendiente, y la UI debe decir qué hay que configurar en vez de pintar un error rojo.
  | 'no_configurada'

export type MetricValue = {
  value: number | null
  status: MetricStatus
  source: FunnelSource
  lastSync: string | null
  /** Solo con status 'error_fuente'. Para poder decir QUÉ falló en vez de un "—" mudo. */
  error?: string
}

// Fuentes que no pueden alimentar series históricas. No es una opinión: la Data Export API de
// Clarity da 10 peticiones por proyecto y día y solo los últimos 1-3 días de datos, y esos límites
// no son ampliables. Marcarla aquí obliga a la UI a decirlo en pantalla en vez de pintar un 0.
export const LIMITED_SOURCES: Partial<Record<FunnelSource, string>> = {
  clarity: 'Clarity solo expone los últimos 1-3 días y 10 peticiones al día: no sirve para histórico.',
}

export function isLimitedSource(source: FunnelSource): boolean {
  return source in LIMITED_SOURCES
}

export const ok = (value: number, source: FunnelSource, lastSync: string | null = null): MetricValue => ({
  value,
  status: 'ok',
  source,
  lastSync,
})

export const sinDatos = (source: FunnelSource, lastSync: string | null = null): MetricValue => ({
  value: 0,
  status: 'sin_datos',
  source,
  lastSync,
})

export const errorFuente = (source: FunnelSource, error: string): MetricValue => ({
  value: null,
  status: 'error_fuente',
  source,
  lastSync: null,
  error,
})

export const noConfigurada = (source: FunnelSource, reason: string): MetricValue => ({
  value: null,
  status: 'no_configurada',
  source,
  lastSync: null,
  error: reason,
})

/**
 * Convierte un recuento leído de una fuente en MetricValue.
 * `rows === null` significa "no se pudo leer", NO "cero": esa distinción es todo el punto.
 */
export function fromCount(
  rows: number | null,
  source: FunnelSource,
  opts: { lastSync?: string | null; error?: string } = {}
): MetricValue {
  if (rows === null) return errorFuente(source, opts.error || 'No se pudo leer la fuente')
  return rows === 0 ? sinDatos(source, opts.lastSync ?? null) : ok(rows, source, opts.lastSync ?? null)
}

/** Un valor es utilizable como número solo si la fuente respondió con un dato. */
export function isUsable(m: MetricValue): boolean {
  return (m.status === 'ok' || m.status === 'sin_datos') && m.value !== null
}

/** Etiqueta corta para pintar el estado sin que el usuario tenga que interpretar un código. */
export const STATUS_LABELS: Record<MetricStatus, string> = {
  ok: 'Dato real',
  sin_datos: 'Sin datos en el periodo',
  error_fuente: 'No se pudo leer la fuente',
  no_configurada: 'Fuente sin configurar',
}
