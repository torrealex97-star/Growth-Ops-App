// Cliente de la Meta (Facebook) Marketing API — Graph API.
// Lee la config de variables de entorno (Sensitive en Vercel) y expone:
//   · fetchMetaCampaigns()  → estado/objetivo/fechas/presupuesto de cada campaña
//   · fetchMetaInsights()   → spend/impressions/clicks/reach + leads por campaña
// Todas las llamadas son a nivel de cuenta (act_XXXX) con level=campaign, así
// que el nº de llamadas NO crece con el nº de campañas (paginación incluida).

import { createHmac } from 'crypto'
import { META_API_VERSION } from '@/lib/meta/api-version'
import { classifyMetaError, MetaError } from '@/lib/meta/errors'
import { isRetryableCode } from '@/lib/integrations/sync-runs'
import { parseAccountIds } from '@/lib/meta/accounts'

export type MetaConfig = {
  token: string
  accountId: string // formato act_1234567890
  version: string // ej. v25.0
  appSecret?: string // para firmar las llamadas con appsecret_proof
  accountName?: string // nombre legible de la cuenta (para filtros de UI)
}

export type AdAccount = {
  id: string // act_1234567890
  name: string
  status?: number // account_status de Meta (1 = activa)
}

export type MetaCampaign = {
  id: string
  name: string
  status: string // ACTIVE / PAUSED / ...
  effective_status?: string
  objective?: string
  start_time?: string
  stop_time?: string
  daily_budget?: string
  lifetime_budget?: string
}

export type MetaInsight = {
  campaign_id: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  leads: number
  followers: number // seguidores atribuidos (action_type de tipo follow)
  linkClicks: number // clics en el enlace (inline_link_clicks)
  landingViews: number // visitas a la página (landing_page_view)
}

// Insight a nivel de ANUNCIO (level=ad). Reutiliza las métricas de MetaInsight
// pero indexado por ad_id (y su campaña).
export type MetaAdInsight = {
  ad_id: string
  campaign_id: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  leads: number
  followers: number
  linkClicks: number
  landingViews: number
}

// Metadatos de un anuncio (sin métricas).
export type MetaAd = {
  id: string
  name: string
  status: string
  effective_status?: string
  adset_name?: string
  campaign_id?: string
}

const GRAPH = 'https://graph.facebook.com'

// Presets válidos de Meta para date_preset. 'maximum' = histórico completo.
export type MetaDatePreset = 'maximum' | 'this_month' | 'last_month' | 'today' | 'this_year' | 'last_90d' | 'last_30d'

export { parseAccountIds } from '@/lib/meta/accounts'

/**
 * Credenciales de Meta tal y como las guarda la subcuenta. Se pasan EXPLÍCITAMENTE en vez de leerse
 * de `process.env`.
 *
 * POR QUÉ. `ensureConfig(tenantId)` vuelca la configuración de una subcuenta en `process.env`, que
 * es global al proceso y NUNCA borra lo que ya había. En el cron, que recorre todas las subcuentas
 * en un bucle dentro de la misma lambda, eso significaba que el token de la subcuenta A seguía
 * puesto al sincronizar la subcuenta B si B no tenía token propio: B se llenaba con las campañas de
 * A, estampadas con el tenant_id de B. Y también explicaba el "borré el App Secret y sigue ahí":
 * el valor borrado de la base de datos continuaba vivo en process.env el resto de la vida de la
 * lambda. Con la config explícita, la configuración GUARDADA es la configuración USADA.
 */
export type MetaEnv = {
  META_ACCESS_TOKEN?: string
  META_API_VERSION?: string
  META_APP_SECRET?: string
  META_AD_ACCOUNT_ID?: string
  META_AD_ACCOUNTS_ALL?: string
}

// Lista TODAS las cuentas publicitarias a las que el token tiene acceso, con su
// nombre legible. Se usa para (a) autodescubrir cuentas cuando no se listan a mano
// y (b) mostrar el nombre en los filtros de la UI. Best-effort: puede fallar si el
// token no tiene permiso `ads_read` sobre el Business.
export async function fetchAdAccounts(
  token: string,
  version = META_API_VERSION,
  appSecret?: string
): Promise<AdAccount[]> {
  // Recortados a propósito: un espacio pegado al copiar el secreto rompe la firma y Meta responde
  // "Invalid appsecret_proof" sin decir que sobra un carácter invisible.
  const secret = appSecret?.trim()
  const proof = secret ? `&appsecret_proof=${createHmac('sha256', secret).update(token.trim()).digest('hex')}` : ''
  const url =
    `${GRAPH}/${version}/me/adaccounts` +
    `?fields=name,account_status&limit=500&access_token=${encodeURIComponent(token)}${proof}`
  const { rows } = await graphGetAll(url)
  return rows.map((r: any) => ({
    id: String(r.id), // Meta ya devuelve el prefijo act_
    name: String(r.name || r.id),
    status: r.account_status != null ? Number(r.account_status) : undefined,
  }))
}

// Resuelve la lista de cuentas a sincronizar, enriquecida con el nombre de cada
// una. Reglas:
//   · Si META_AD_ACCOUNT_ID trae ids explícitos → se usan esos (comportamiento
//     previo), pero se les añade el nombre descubierto por /me/adaccounts.
//   · Si NO hay ids explícitos, o META_AD_ACCOUNTS_ALL está activo → se sincronizan
//     TODAS las cuentas accesibles por el token.
// El descubrimiento de nombres es best-effort: si /me/adaccounts falla, seguimos
// con lo que haya (sin nombre) para no romper la sync.
export async function resolveMetaConfigs(env: MetaEnv): Promise<MetaConfig[]> {
  const token = env.META_ACCESS_TOKEN?.trim()
  if (!token) {
    throw new MetaError({
      code: 'sin_credenciales',
      message:
        'Falta el token de Meta en esta subcuenta. Pégalo en Configuración › Integraciones › Meta Ads y elige la cuenta publicitaria.',
    })
  }
  const version = env.META_API_VERSION || META_API_VERSION
  const appSecret = env.META_APP_SECRET?.trim() || undefined
  const explicit = parseAccountIds(env.META_AD_ACCOUNT_ID)
  const wantAll = explicit.length === 0 || /^(1|true|all|todas|todos)$/i.test((env.META_AD_ACCOUNTS_ALL || '').trim())

  let discovered: AdAccount[] = []
  let discoveryError: unknown = null
  try {
    discovered = await fetchAdAccounts(token, version, appSecret)
  } catch (err) {
    // Con cuentas escritas a mano el descubrimiento es solo para poner nombres: si falla, seguimos.
    // Sin cuentas escritas a mano ES la única forma de saber qué sincronizar, así que el error del
    // token tiene que llegar arriba — devolver "faltan credenciales" mandaba a revisar un campo
    // que estaba perfecto mientras el problema real era el token o la firma.
    discoveryError = err
    discovered = []
  }
  if (explicit.length === 0 && discoveryError) throw discoveryError
  const nameById = new Map(discovered.map((a) => [a.id, a.name]))

  const ids = wantAll && discovered.length > 0 ? discovered.map((a) => a.id) : explicit
  const uniq = Array.from(new Set(ids))
  if (uniq.length === 0) {
    throw new MetaError({
      code: 'sin_cuentas',
      message:
        'El token de Meta funciona pero no ve ninguna cuenta publicitaria. Da acceso a la cuenta desde Meta Business y vuelve a comprobar.',
    })
  }
  return uniq.map((accountId) => ({
    token,
    accountId,
    version,
    appSecret,
    accountName: nameById.get(accountId),
  }))
}

// appsecret_proof = HMAC-SHA256(access_token) con la app secret. Requerido si la
// app tiene activado "Require app secret" para llamadas desde servidor.
function proofParam(cfg: MetaConfig): string {
  if (!cfg.appSecret) return ''
  const proof = createHmac('sha256', cfg.appSecret.trim()).update(cfg.token.trim()).digest('hex')
  return `&appsecret_proof=${proof}`
}

async function graphGetOnce(url: string): Promise<any> {
  // Timeout duro: sin esto, si la Graph API de Meta se cuelga, el cron consume toda su ventana
  // (maxDuration) en esta única llamada — mismo patrón que lib/calendly.ts. graphGetAll pagina
  // llamando a esta función en bucle, así que sin timeout un solo hueco cuelga toda la sync.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MetaError({ code: 'timeout', message: 'Meta API tardó demasiado en responder (timeout).' })
    }
    throw new MetaError({ code: 'red', message: 'No se pudo conectar con la API de Meta.' })
  } finally {
    clearTimeout(timer)
  }
  const json = await res.json()
  if (!res.ok || json?.error) {
    // Se lanza la causa ya traducida (token caducado, falta permiso, id de cuenta que Meta no
    // reconoce…) en vez del mensaje en inglés para desarrolladores: quien ve esto es quien tiene que
    // arreglarlo, y "Unsupported get request" no le dice qué hacer.
    throw new MetaError(classifyMetaError(json, res.status))
  }
  return json
}

/** Reintentos SOLO para lo que tiene sentido reintentar: rate limit, error temporal o timeout. */
const RETRY_DELAYS_MS = [800, 2400]

async function graphGet(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await graphGetOnce(url)
    } catch (err) {
      const code = err instanceof MetaError ? err.code : null
      // Un token caducado o un permiso que falta no se arreglan repitiendo la llamada: reintentar
      // ahí solo gasta la ventana del cron y multiplica las peticiones contra el rate limit.
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryableCode(code)) throw err
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
  }
}

// Sigue la paginación de la Graph API (data + paging.next) acumulando resultados.
// Sigue la paginación de la Graph API acumulando resultados, con un tope de páginas para no
// quedarse dando vueltas.
//
// DEVUELVE SI SE QUEDÓ A MEDIAS. Antes el tope (50 páginas) se aplicaba en silencio y la función
// devolvía el trozo leído como si fuera todo. Con `limit=500` eso son 25.000 filas: suficiente para
// el día a día, pero NO para una carga de histórico con `time_increment=1` (una fila por campaña y
// día: 37 meses × unas decenas de campañas se pasan de largo). El resultado era un histórico
// incompleto presentado como completo — el peor tipo de fallo de esta base de datos.
const DEFAULT_MAX_PAGES = 50

async function graphGetAll(
  firstUrl: string,
  maxPages = DEFAULT_MAX_PAGES
): Promise<{ rows: any[]; truncated: boolean }> {
  const out: any[] = []
  let url: string | null = firstUrl
  let guard = 0
  while (url) {
    if (guard >= maxPages) return { rows: out, truncated: true }
    const json: any = await graphGet(url)
    if (Array.isArray(json?.data)) out.push(...json.data)
    url = json?.paging?.next || null
    guard++
  }
  return { rows: out, truncated: false }
}

export async function fetchMetaCampaigns(cfg: MetaConfig): Promise<MetaCampaign[]> {
  const fields = 'id,name,status,effective_status,objective,start_time,stop_time,daily_budget,lifetime_budget'
  const url = `${GRAPH}/${cfg.version}/${cfg.accountId}/campaigns?fields=${fields}&limit=200&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const { rows } = await graphGetAll(url)
  return rows as MetaCampaign[]
}

// Extrae el nº de leads de la lista `actions` de un insight. Meta reporta los
// leads con distintos action_type según el origen (píxel, formularios instantáneos, CAPI):
const LEAD_ACTION_TYPES = new Set([
  'lead',
  'leadgen_grouped',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
])

function parseLeads(actions: any): number {
  if (!Array.isArray(actions)) return 0
  let total = 0
  for (const a of actions) {
    if (LEAD_ACTION_TYPES.has(a?.action_type)) total += Number(a?.value) || 0
  }
  return total
}

// Seguidores atribuidos por Meta. El action_type varía según el tipo de campaña
// (captación de seguidores). Se reporta SOLO en campañas con ese objetivo; en
// campañas de tráfico/vídeo no aparece (devuelve 0). Cubrimos las variantes
// conocidas para que la métrica se rellene sola cuando se lancen campañas al perfil.
const FOLLOW_ACTION_TYPES = new Set([
  'follow',
  'onsite_conversion.follow',
  'ig_follow',
  'onsite_conversion.ig_follow',
  'onsite_conversion.instagram_follow',
])

function parseFollows(actions: any): number {
  if (!Array.isArray(actions)) return 0
  let total = 0
  for (const a of actions) {
    if (FOLLOW_ACTION_TYPES.has(a?.action_type)) total += Number(a?.value) || 0
  }
  return total
}

// Suma el valor de un action_type concreto (p. ej. 'landing_page_view').
function sumAction(actions: any, type: string): number {
  if (!Array.isArray(actions)) return 0
  let total = 0
  for (const a of actions) {
    if (a?.action_type === type) total += Number(a?.value) || 0
  }
  return total
}

export async function fetchMetaInsights(
  cfg: MetaConfig,
  datePreset: MetaDatePreset = 'maximum'
): Promise<MetaInsight[]> {
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,reach,actions'
  const url =
    `${GRAPH}/${cfg.version}/${cfg.accountId}/insights` +
    `?level=campaign&fields=${fields}&date_preset=${datePreset}&limit=500` +
    `&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const { rows } = await graphGetAll(url)
  return rows.map((r: any) => ({
    campaign_id: String(r.campaign_id),
    campaign_name: String(r.campaign_name || ''),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    reach: Number(r.reach) || 0,
    leads: parseLeads(r.actions),
    followers: parseFollows(r.actions),
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingViews: sumAction(r.actions, 'landing_page_view'),
  }))
}

// Insight DIARIO por campaña (level=campaign, time_increment=1). Devuelve una fila por
// (campaña, día) con el gasto/impresiones/clics/leads de ESE día. Es lo que permite filtrar
// el gasto por rango real (este mes, este trimestre…) en vez de mostrar el total histórico.
export type MetaDailyInsight = {
  campaign_id: string
  campaign_name: string
  date: string // YYYY-MM-DD
  spend: number
  impressions: number
  clicks: number
  leads: number
  reach: number
  linkClicks: number // clics en el enlace (inline_link_clicks) de ESE día
  landingViews: number // visitas a la página (landing_page_view) de ESE día
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type MetaDailyInsightsResult = { rows: MetaDailyInsight[]; truncated: boolean }

export async function fetchMetaDailyInsights(cfg: MetaConfig, sinceDays = 180): Promise<MetaDailyInsightsResult> {
  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - Math.max(1, sinceDays))
  const timeRange = encodeURIComponent(JSON.stringify({ since: ymd(since), until: ymd(until) }))
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,reach,actions'
  const url =
    `${GRAPH}/${cfg.version}/${cfg.accountId}/insights` +
    `?level=campaign&fields=${fields}&time_increment=1&time_range=${timeRange}&limit=500` +
    `&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  // Presupuesto de páginas proporcional al rango pedido: una carga de 37 meses necesita muchas más
  // que un sync rutinario de 180 días, y quedarse corto aquí es exactamente lo que dejaba el
  // histórico a medias sin decirlo.
  const maxPages = Math.max(DEFAULT_MAX_PAGES, Math.ceil(sinceDays / 5))
  const { rows, truncated } = await graphGetAll(url, maxPages)
  const mapped = rows.map((r: any) => ({
    campaign_id: String(r.campaign_id),
    campaign_name: String(r.campaign_name || r.campaign_id),
    date: String(r.date_start || '').slice(0, 10),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    leads: parseLeads(r.actions),
    reach: Number(r.reach) || 0,
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingViews: sumAction(r.actions, 'landing_page_view'),
  }))
  return { rows: mapped, truncated }
}

// Lista los ANUNCIOS de la cuenta (metadatos, sin métricas). Una sola llamada
// paginada por cuenta (no crece con el nº de campañas).
export async function fetchMetaAds(cfg: MetaConfig): Promise<MetaAd[]> {
  const fields = 'id,name,status,effective_status,adset{name},campaign{id}'
  const url = `${GRAPH}/${cfg.version}/${cfg.accountId}/ads?fields=${fields}&limit=200&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const { rows } = await graphGetAll(url)
  return rows.map((r: any) => ({
    id: String(r.id),
    name: String(r.name || ''),
    status: String(r.status || ''),
    effective_status: r.effective_status ? String(r.effective_status) : undefined,
    adset_name: r.adset?.name ? String(r.adset.name) : undefined,
    campaign_id: r.campaign?.id ? String(r.campaign.id) : undefined,
  }))
}

// Insights a nivel de ANUNCIO. Una sola llamada paginada por cuenta con level=ad.
export async function fetchMetaAdInsights(
  cfg: MetaConfig,
  datePreset: MetaDatePreset = 'maximum'
): Promise<MetaAdInsight[]> {
  const fields = 'ad_id,campaign_id,spend,impressions,clicks,inline_link_clicks,reach,actions'
  const url =
    `${GRAPH}/${cfg.version}/${cfg.accountId}/insights` +
    `?level=ad&fields=${fields}&date_preset=${datePreset}&limit=500` +
    `&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const { rows } = await graphGetAll(url)
  return rows.map((r: any) => ({
    ad_id: String(r.ad_id),
    campaign_id: String(r.campaign_id || ''),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    reach: Number(r.reach) || 0,
    leads: parseLeads(r.actions),
    followers: parseFollows(r.actions),
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingViews: sumAction(r.actions, 'landing_page_view'),
  }))
}
