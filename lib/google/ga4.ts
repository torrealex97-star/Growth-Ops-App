// Cliente de la Data API de GA4 y normalización de sus filas.
//
// Se llama a la API REST directamente en vez de usar el SDK de googleapis: para dos endpoints de
// lectura, el SDK añade un árbol de dependencias grande a un bundle serverless sin ganar nada.
import { decryptSecret } from '@/lib/config'
import type { GoogleCredentials } from '@/lib/google/oauth'

export type Ga4Row = {
  date: string // YYYY-MM-DD
  source: string
  medium: string
  campaign: string
  landing_page: string
  device: string
  sessions: number
  active_users: number
  new_users: number
  conversions: number
  engaged_sessions: number
}

/** Dimensiones y métricas que se piden, en este orden. El orden importa: la respuesta es posicional. */
const DIMENSIONS = ['date', 'sessionSource', 'sessionMedium', 'sessionCampaignName', 'landingPage', 'deviceCategory']
const METRICS = ['sessions', 'activeUsers', 'newUsers', 'conversions', 'engagedSessions']

/**
 * Access token a partir del refresh token guardado (cifrado).
 * Devuelve el error en vez de lanzar, para que quien llama pueda anotarlo en `last_error` de la
 * conexión y la pantalla diga qué pasa en vez de un fallo genérico.
 */
export async function accessTokenFromRefresh(
  encryptedRefreshToken: string,
  creds: GoogleCredentials
): Promise<{ token: string } | { error: string; revoked: boolean }> {
  let refresh: string
  try {
    refresh = decryptSecret(encryptedRefreshToken)
  } catch {
    return { error: 'No se pudo descifrar el refresh token (¿cambió CONFIG_ENC_KEY?)', revoked: false }
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  if (!r.ok || !j.access_token) {
    // invalid_grant = el usuario revocó el acceso o cambió la contraseña. Es un estado distinto de
    // un fallo temporal: hay que volver a conectar, no reintentar.
    const revoked = j.error === 'invalid_grant'
    return { error: j.error_description || j.error || `Google respondió ${r.status}`, revoked }
  }
  return { token: j.access_token }
}

export type Ga4Property = { name: string; displayName: string; account: string }

/** Propiedades de GA4 accesibles con este token, para que el usuario elija una. */
export async function listProperties(accessToken: string): Promise<{ items: Ga4Property[] } | { error: string }> {
  const r = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const j = (await r.json().catch(() => ({}))) as {
    accountSummaries?: Array<{
      account?: string
      displayName?: string
      propertySummaries?: Array<{ property?: string; displayName?: string }>
    }>
    error?: { message?: string }
  }
  if (!r.ok) return { error: j.error?.message || `Google respondió ${r.status}` }
  const items: Ga4Property[] = []
  for (const acc of j.accountSummaries ?? []) {
    for (const prop of acc.propertySummaries ?? []) {
      if (prop.property) {
        items.push({
          name: prop.property, // "properties/123456789"
          displayName: prop.displayName || prop.property,
          account: acc.displayName || acc.account || '',
        })
      }
    }
  }
  return { items }
}

// GA4 devuelve '(not set)', '(none)' y '(direct)' cuando no hay valor. Se normalizan a cadena vacía
// para que coincidan con el DEFAULT '' de la tabla: si entraran tal cual, el mismo tráfico directo
// aparecería como varias fuentes distintas según el día y el histórico quedaría fragmentado.
const EMPTY_MARKERS = new Set(['(not set)', '(none)', '(direct)', '(other)'])
export function normalizeDimension(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  if (!v || EMPTY_MARKERS.has(v.toLowerCase())) return ''
  return v
}

/** 'YYYYMMDD' (formato de GA4) → 'YYYY-MM-DD'. */
export function normalizeGa4Date(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((value || '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const num = (v: string | null | undefined): number => {
  const n = Number(v)
  // Un valor no numérico se trata como 0 y no como NaN: NaN rompería el CHECK de la tabla y abortaría
  // la pasada entera por una fila rara.
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Convierte la respuesta cruda de runReport en filas listas para la tabla. */
export function mapReportRows(payload: {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>
}): Ga4Row[] {
  const out: Ga4Row[] = []
  for (const row of payload.rows ?? []) {
    const d = row.dimensionValues ?? []
    const m = row.metricValues ?? []
    const date = normalizeGa4Date(d[0]?.value ?? '')
    // Sin fecha la fila no se puede colocar en el histórico: se descarta en vez de inventar un día.
    if (!date) continue
    out.push({
      date,
      source: normalizeDimension(d[1]?.value),
      medium: normalizeDimension(d[2]?.value),
      campaign: normalizeDimension(d[3]?.value),
      landing_page: normalizeDimension(d[4]?.value),
      device: normalizeDimension(d[5]?.value),
      sessions: num(m[0]?.value),
      active_users: num(m[1]?.value),
      new_users: num(m[2]?.value),
      conversions: num(m[3]?.value),
      engaged_sessions: num(m[4]?.value),
    })
  }
  return out
}

/** Límite de filas por petición de la Data API. Se pagina con offset. */
export const GA4_PAGE_SIZE = 100_000

export async function runReport(opts: {
  accessToken: string
  propertyId: string // "properties/123456789" o "123456789"
  from: string
  to: string
  offset: number
}): Promise<{ rows: Ga4Row[]; total: number } | { error: string }> {
  const property = opts.propertyId.startsWith('properties/') ? opts.propertyId : `properties/${opts.propertyId}`
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: opts.from, endDate: opts.to }],
      dimensions: DIMENSIONS.map((name) => ({ name })),
      metrics: METRICS.map((name) => ({ name })),
      limit: GA4_PAGE_SIZE,
      offset: opts.offset,
      // Sin esto GA4 puede devolver filas agregadas de "otros" al superar su límite de cardinalidad,
      // y esas filas contaminarían el desglose por landing.
      keepEmptyRows: false,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const j = (await r.json().catch(() => ({}))) as {
    rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>
    rowCount?: number
    error?: { message?: string }
  }
  if (!r.ok) return { error: j.error?.message || `Google respondió ${r.status}` }
  return { rows: mapReportRows(j), total: j.rowCount ?? 0 }
}
