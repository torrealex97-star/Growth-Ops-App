// TIPO DE CAMBIO (F04 · MONEY D2): moneda base EUR, tipo del BCE a la fecha del hecho.
//
// Fuente: Frankfurter (api.frankfurter.dev), que sirve los tipos de referencia diarios del BCE sin
// clave. Para un festivo o fin de semana devuelve el último día publicado y lo dice en `date`: esa
// fecha se guarda junto al tipo. Puro salvo `obtenerTasaAEur`, que recibe el fetch.

export const MONEDA_BASE = 'eur'

export type TasaAEur = { rate: number; date: string }

/** Respuesta de Frankfurter para `?base=XXX&symbols=EUR` → tasa EUR por 1 unidad, o null si no vale. */
export function parsearTasaFrankfurter(json: unknown): TasaAEur | null {
  if (!json || typeof json !== 'object') return null
  const j = json as { date?: unknown; rates?: { EUR?: unknown } }
  const rate = Number(j.rates?.EUR)
  if (!Number.isFinite(rate) || rate <= 0) return null
  if (typeof j.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) return null
  return { rate, date: j.date }
}

export const esMonedaBase = (moneda: string | null | undefined): boolean =>
  !moneda || moneda.trim().toLowerCase() === MONEDA_BASE

/** Tasa de la moneda a EUR para un día (YYYY-MM-DD). `null` ante cualquier fallo: sin tipo no se inventa. */
export async function obtenerTasaAEur(
  moneda: string,
  dia: string,
  fetchImpl: typeof fetch = fetch
): Promise<TasaAEur | null> {
  if (esMonedaBase(moneda) || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null
  try {
    const url = `https://api.frankfurter.dev/v1/${dia}?base=${encodeURIComponent(moneda.trim().toUpperCase())}&symbols=EUR`
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return parsearTasaFrankfurter(await res.json())
  } catch {
    return null
  }
}
