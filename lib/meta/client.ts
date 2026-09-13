// Cliente de la Meta (Facebook) Marketing API — Graph API.
// Lee la config de variables de entorno (Sensitive en Vercel) y expone:
//   · fetchMetaCampaigns()  → estado/objetivo/fechas/presupuesto de cada campaña
//   · fetchMetaInsights()   → spend/impressions/clicks/reach + leads por campaña
// Todas las llamadas son a nivel de cuenta (act_XXXX) con level=campaign, así
// que el nº de llamadas NO crece con el nº de campañas (paginación incluida).

import { createHmac } from 'crypto'
import { META_API_VERSION } from '@/lib/meta/api-version'
import { classifyMetaError } from '@/lib/meta/errors'

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

// Normaliza un id de cuenta: acepta "act_123" o "123" → "act_123".
function normalizeAccountId(raw: string): string {
  const id = raw.trim()
  return id.startsWith('act_') ? id : `act_${id}`
}

// Parte la config de cuentas en una lista. Admite varias cuentas separadas por
// comas, saltos de línea, espacios o punto y coma. Todas comparten el MISMO token.
export function parseAccountIds(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeAccountId)
}

export function getMetaConfig(): MetaConfig | null {
  return getMetaConfigs()[0] ?? null
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
  const proof = appSecret ? `&appsecret_proof=${createHmac('sha256', appSecret).update(token).digest('hex')}` : ''
  const url =
    `${GRAPH}/${version}/me/adaccounts` +
    `?fields=name,account_status&limit=500&access_token=${encodeURIComponent(token)}${proof}`
  const rows = await graphGetAll(url)
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
export async function resolveMetaConfigs(): Promise<MetaConfig[]> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) return []
  const version = process.env.META_API_VERSION || META_API_VERSION
  const appSecret = process.env.META_APP_SECRET || undefined
  const explicit = parseAccountIds(process.env.META_AD_ACCOUNT_ID)
  const wantAll =
    explicit.length === 0 || /^(1|true|all|todas|todos)$/i.test((process.env.META_AD_ACCOUNTS_ALL || '').trim())

  let discovered: AdAccount[] = []
  try {
    discovered = await fetchAdAccounts(token, version, appSecret)
  } catch {
    discovered = []
  }
  const nameById = new Map(discovered.map((a) => [a.id, a.name]))

  const ids = wantAll && discovered.length > 0 ? discovered.map((a) => a.id) : explicit
  const uniq = Array.from(new Set(ids))
  return uniq.map((accountId) => ({
    token,
    accountId,
    version,
    appSecret,
    accountName: nameById.get(accountId),
  }))
}

// Devuelve una config por cada cuenta publicitaria declarada en
// META_AD_ACCOUNT_ID (una o varias, separadas por comas). Lista vacía si faltan
// credenciales. Todas comparten token/versión/appSecret.
export function getMetaConfigs(): MetaConfig[] {
  const token = process.env.META_ACCESS_TOKEN
  const accountIds = parseAccountIds(process.env.META_AD_ACCOUNT_ID)
  if (!token || accountIds.length === 0) return []
  const version = process.env.META_API_VERSION || META_API_VERSION
  const appSecret = process.env.META_APP_SECRET || undefined
  return accountIds.map((accountId) => ({ token, accountId, version, appSecret }))
}

// appsecret_proof = HMAC-SHA256(access_token) con la app secret. Requerido si la
// app tiene activado "Require app secret" para llamadas desde servidor.
function proofParam(cfg: MetaConfig): string {
  if (!cfg.appSecret) return ''
  const proof = createHmac('sha256', cfg.appSecret).update(cfg.token).digest('hex')
  return `&appsecret_proof=${proof}`
}

async function graphGet(url: string): Promise<any> {
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
      throw new Error('Meta API tardó demasiado en responder (timeout)')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  const json = await res.json()
  if (!res.ok || json?.error) {
    // Se lanza la causa ya traducida (token caducado, falta permiso, id de cuenta que Meta no
    // reconoce…) en vez del mensaje en inglés para desarrolladores: quien ve esto es quien tiene que
    // arreglarlo, y "Unsupported get request" no le dice qué hacer.
    throw new Error(classifyMetaError(json, res.status).message)
  }
  return json
}

// Sigue la paginación de la Graph API (data + paging.next) acumulando resultados.
async function graphGetAll(firstUrl: string): Promise<any[]> {
  const out: any[] = []
  let url: string | null = firstUrl
  let guard = 0
  while (url && guard < 50) {
    const json: any = await graphGet(url)
    if (Array.isArray(json?.data)) out.push(...json.data)
    url = json?.paging?.next || null
    guard++
  }
  return out
}

export async function fetchMetaCampaigns(cfg: MetaConfig): Promise<MetaCampaign[]> {
  const fields = 'id,name,status,effective_status,objective,start_time,stop_time,daily_budget,lifetime_budget'
  const url = `${GRAPH}/${cfg.version}/${cfg.accountId}/campaigns?fields=${fields}&limit=200&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const rows = await graphGetAll(url)
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
  const rows = await graphGetAll(url)
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

export async function fetchMetaDailyInsights(cfg: MetaConfig, sinceDays = 180): Promise<MetaDailyInsight[]> {
  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - Math.max(1, sinceDays))
  const timeRange = encodeURIComponent(JSON.stringify({ since: ymd(since), until: ymd(until) }))
  const fields = 'campaign_id,spend,impressions,clicks,inline_link_clicks,reach,actions'
  const url =
    `${GRAPH}/${cfg.version}/${cfg.accountId}/insights` +
    `?level=campaign&fields=${fields}&time_increment=1&time_range=${timeRange}&limit=500` +
    `&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const rows = await graphGetAll(url)
  return rows.map((r: any) => ({
    campaign_id: String(r.campaign_id),
    date: String(r.date_start || '').slice(0, 10),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    leads: parseLeads(r.actions),
    reach: Number(r.reach) || 0,
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingViews: sumAction(r.actions, 'landing_page_view'),
  }))
}

// Lista los ANUNCIOS de la cuenta (metadatos, sin métricas). Una sola llamada
// paginada por cuenta (no crece con el nº de campañas).
export async function fetchMetaAds(cfg: MetaConfig): Promise<MetaAd[]> {
  const fields = 'id,name,status,effective_status,adset{name},campaign{id}'
  const url = `${GRAPH}/${cfg.version}/${cfg.accountId}/ads?fields=${fields}&limit=200&access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}`
  const rows = await graphGetAll(url)
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
  const rows = await graphGetAll(url)
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
