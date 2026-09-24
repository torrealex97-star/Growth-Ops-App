// Cliente de la Instagram Graph API (orgánico).
// Distinto de lib/meta/client.ts (ese es la Marketing/Ads API). Aquí leemos el
// contenido orgánico: reels/posts + sus insights, crecimiento de la cuenta,
// demografía de la audiencia, comentarios y conversaciones (DMs).
//
// Reutiliza el mismo patrón que Meta: firma con appsecret_proof + paginación.
// Cada llamada de insights es DEFENSIVA: si Instagram rechaza una métrica para
// un tipo de media, capturamos el error y devolvemos lo que sí tengamos (así una
// métrica no soportada no tumba toda la sincronización).

import { createHmac } from 'crypto'
import { META_API_VERSION } from '@/lib/meta/api-version'

export type IgConfig = {
  token: string
  igUserId?: string // id de la cuenta IG business (si no, se resuelve por /me/accounts)
  version: string
  appSecret?: string
  pageId?: string // página de Facebook vinculada (si no, se resuelve por /me/accounts)
  enableDmSync?: boolean // requiere acceso avanzado a instagram_manage_messages
}

const GRAPH = 'https://graph.facebook.com'

export type InstagramErrorCode = 'token_caducado' | 'token_invalido' | 'sin_permisos' | 'limite_de_uso' | 'timeout'

class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly code: InstagramErrorCode
  ) {
    super(message)
    this.name = 'InstagramApiError'
  }
}
export { InstagramApiError }

function instagramErrorCode(providerCode: number | null, message: string): InstagramErrorCode {
  if (providerCode === 10) return 'sin_permisos'
  if ([4, 17, 32, 613].includes(providerCode ?? -1)) return 'limite_de_uso'
  if (providerCode === 190 && /expir|caduc/i.test(message)) return 'token_caducado'
  return 'token_invalido'
}

/**
 * Credenciales de Instagram tal y como las guarda la subcuenta. Se pasan EXPLÍCITAMENTE, igual que
 * en lib/meta/client.ts y por el mismo motivo: `ensureConfig(tenantId)` las vuelca en `process.env`,
 * que es global al proceso y nunca borra lo anterior. En el cron, que recorre todas las subcuentas
 * dentro de la misma lambda, la segunda heredaba el token de la primera y se llenaba con SU
 * Instagram, estampado con su propio tenant_id.
 */
export type IgEnv = {
  INSTAGRAM_ACCESS_TOKEN?: string
  META_ACCESS_TOKEN?: string
  IG_USER_ID?: string
  META_API_VERSION?: string
  META_APP_SECRET?: string
  IG_PAGE_ID?: string
  IG_ENABLE_DM_SYNC?: string
}

export function getInstagramConfig(env: IgEnv): IgConfig | null {
  // Token propio de IG si existe; si no, el mismo del System User WINNER.
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || env.META_ACCESS_TOKEN?.trim()
  if (!token) return null
  return {
    token,
    igUserId: env.IG_USER_ID?.trim() || undefined,
    version: env.META_API_VERSION || META_API_VERSION,
    appSecret: env.META_APP_SECRET?.trim() || undefined,
    // También por config explícita: la página de Facebook vinculada es DE la subcuenta, y leerla de
    // process.env hacía que una subcuenta pudiera acabar escribiendo los reels de la página de otra.
    pageId: env.IG_PAGE_ID?.trim() || undefined,
    enableDmSync: env.IG_ENABLE_DM_SYNC === '1',
  }
}

function proofParam(cfg: IgConfig): string {
  if (!cfg.appSecret) return ''
  const proof = createHmac('sha256', cfg.appSecret).update(cfg.token).digest('hex')
  return `&appsecret_proof=${proof}`
}

function q(cfg: IgConfig, extra = ''): string {
  return `access_token=${encodeURIComponent(cfg.token)}${proofParam(cfg)}${extra}`
}

// Timeout duro (15s), igual que lib/meta/client.ts y lib/calendly.ts. Sin esto, una llamada
// colgada de la Graph API se come toda la ventana del cron de Instagram (maxDuration) — y como
// `graphGetAll` pagina llamando a esta función en bucle, un solo hueco cuelga la sync entera.
const IG_TIMEOUT_MS = 15_000

async function graphGet(url: string): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(IG_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new InstagramApiError('La API de Instagram tardó demasiado en responder (timeout)', 'timeout')
    }
    throw err
  }
  const json = await res.json()
  if (!res.ok || json?.error) {
    const err = json?.error
    const providerCode = Number.isFinite(Number(err?.code)) ? Number(err.code) : null
    const message = err?.message || res.statusText || 'desconocido'
    throw new InstagramApiError(
      `Instagram API error${providerCode ? ` (${providerCode})` : ''}: ${message}`,
      instagramErrorCode(providerCode, message)
    )
  }
  return json
}

/**
 * La forma de lo que devuelve el Graph API, acotada igual que en lib/meta/client.ts: no se finge conocer
 * su esquema completo —cambia sin avisar— sino que es un objeto de claves desconocidas. Con eso, leer un
 * campo obliga a convertirlo, que es lo que ya hace este fichero con String()/Number(). Con `any`, un
 * campo renombrado por Meta pasaba a `undefined` en silencio.
 */
type FilaGraph = Record<string, unknown>

/** Convierte un campo del Graph API a texto opcional. `''` y ausente son lo mismo: no hay dato. */
function texto(v: unknown): string | undefined {
  return v == null || v === '' ? undefined : String(v)
}

/** Lee una clave de un objeto embebido del Graph API, sin dar por hecho que el embebido llegó. */
function leerAnidado(valor: unknown, clave: string): string | undefined {
  if (!valor || typeof valor !== 'object') return undefined
  return texto((valor as Record<string, unknown>)[clave])
}

async function graphGetAll(firstUrl: string, maxPages = 50): Promise<FilaGraph[]> {
  const out: FilaGraph[] = []
  let url: string | null = firstUrl
  let guard = 0
  while (url && guard < maxPages) {
    const json = (await graphGet(url)) as { data?: unknown; paging?: { next?: string | null } }
    if (Array.isArray(json?.data)) out.push(...(json.data as FilaGraph[]))
    url = json?.paging?.next || null
    guard++
  }
  return out
}

// Resuelve el id de la cuenta IG business. Si IG_USER_ID está en env, lo usa.
// Si no, recorre las páginas de Facebook del token buscando instagram_business_account.
export async function resolveIgUserId(cfg: IgConfig): Promise<{ id: string; username?: string }> {
  if (cfg.igUserId) return { id: cfg.igUserId }
  const url = `${GRAPH}/${cfg.version}/me/accounts?fields=instagram_business_account{id,username}&limit=100&${q(cfg)}`
  const pages = await graphGetAll(url)
  for (const p of pages) {
    const id = leerAnidado(p?.instagram_business_account, 'id')
    if (id) return { id, username: leerAnidado(p?.instagram_business_account, 'username') }
  }
  throw new Error(
    'No encuentro ninguna cuenta de Instagram business vinculada al token. Verifica que tu cuenta es profesional, está vinculada a una página de Facebook, y que la página está asignada al System User del token (o define IG_USER_ID).'
  )
}

export type IgProfile = {
  id: string
  username?: string
  name?: string
  followers_count: number
  media_count: number
}

export async function fetchIgProfile(cfg: IgConfig, igId: string): Promise<IgProfile> {
  const url = `${GRAPH}/${cfg.version}/${igId}?fields=id,username,name,followers_count,media_count&${q(cfg)}`
  const j = await graphGet(url)
  return {
    id: String(j.id),
    username: j.username,
    name: j.name,
    followers_count: Number(j.followers_count) || 0,
    media_count: Number(j.media_count) || 0,
  }
}

export type IgMedia = {
  id: string
  media_type?: string
  media_product_type?: string
  caption?: string
  permalink?: string
  thumbnail_url?: string
  media_url?: string
  timestamp?: string
  like_count: number
  comments_count: number
}

// Lista de medias (reels + posts) con los campos base. Insights se piden aparte
// por media (fetchMediaInsights) porque el set de métricas depende del tipo.
export async function fetchIgMedia(cfg: IgConfig, igId: string, limit = 100): Promise<IgMedia[]> {
  const fields =
    'id,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count'
  const url = `${GRAPH}/${cfg.version}/${igId}/media?fields=${fields}&limit=${Math.min(limit, 100)}&${q(cfg)}`
  const rows = await graphGetAll(url, Math.ceil(limit / 100) + 1)
  return rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    media_type: texto(r.media_type),
    media_product_type: texto(r.media_product_type),
    caption: texto(r.caption),
    permalink: texto(r.permalink),
    thumbnail_url: texto(r.thumbnail_url),
    media_url: texto(r.media_url),
    timestamp: texto(r.timestamp),
    like_count: Number(r.like_count) || 0,
    comments_count: Number(r.comments_count) || 0,
  }))
}

export type MediaInsights = {
  reach: number
  views: number
  likes: number
  comments: number
  shares: number
  saved: number
  total_interactions: number
  avg_watch_time: number
  reach_followers: number
  reach_non_followers: number
  follows: number
}

const emptyInsights = (): MediaInsights => ({
  reach: 0,
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saved: 0,
  total_interactions: 0,
  avg_watch_time: 0,
  reach_followers: 0,
  reach_non_followers: 0,
  follows: 0,
})

// Pide un set de métricas y devuelve un mapa metric->value. Si Instagram rechaza
// el conjunto entero (una métrica inválida tumba la llamada), reintenta métrica a
// métrica para quedarnos con las que sí soporta ese media.
async function fetchMetricSet(cfg: IgConfig, mediaId: string, metrics: string[]): Promise<Record<string, number>> {
  const call = async (ms: string[]): Promise<Record<string, number>> => {
    const url = `${GRAPH}/${cfg.version}/${mediaId}/insights?metric=${ms.join(',')}&${q(cfg)}`
    const j = await graphGet(url)
    const out: Record<string, number> = {}
    for (const row of j?.data || []) {
      const name = row?.name
      // total_value (métricas nuevas) o values[0].value (clásicas)
      const v = row?.total_value?.value ?? row?.values?.[0]?.value ?? 0
      if (name) out[name] = Number(v) || 0
    }
    return out
  }
  try {
    return await call(metrics)
  } catch {
    const out: Record<string, number> = {}
    for (const m of metrics) {
      try {
        Object.assign(out, await call([m]))
      } catch {
        /* métrica no soportada: la saltamos */
      }
    }
    return out
  }
}

// Insights de un media. Elige el set de métricas según sea reel o feed.
export async function fetchMediaInsights(cfg: IgConfig, media: IgMedia): Promise<MediaInsights> {
  const isReel = (media.media_product_type || '').toUpperCase() === 'REELS'
  const base = ['reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions']
  const metrics = isReel ? [...base, 'views', 'ig_reels_avg_watch_time'] : [...base, 'views', 'profile_visits']
  const m = await fetchMetricSet(cfg, media.id, metrics)

  const ins = emptyInsights()
  ins.reach = m.reach ?? 0
  ins.views = m.views ?? 0
  ins.likes = m.likes ?? media.like_count ?? 0
  ins.comments = m.comments ?? media.comments_count ?? 0
  ins.shares = m.shares ?? 0
  ins.saved = m.saved ?? 0
  ins.total_interactions = m.total_interactions ?? ins.likes + ins.comments + ins.shares + ins.saved
  ins.avg_watch_time = m.ig_reels_avg_watch_time ?? 0

  // Reach por tipo de seguidor (descubrimiento) — breakdown aparte, best-effort.
  try {
    const url = `${GRAPH}/${cfg.version}/${media.id}/insights?metric=reach&breakdown=follow_type&${q(cfg)}`
    const j = await graphGet(url)
    const results = j?.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
    for (const r of results) {
      const key = String(r?.dimension_values?.[0] || '').toLowerCase()
      const v = Number(r?.value) || 0
      if (key.includes('non')) ins.reach_non_followers = v
      else if (key.includes('follow')) ins.reach_followers = v
    }
  } catch {
    /* breakdown no disponible en esta cuenta/versión */
  }

  return ins
}

export type AccountInsights = {
  reach: number
  profile_views: number
  new_follows: number
  unfollows: number
  reach_followers: number
  reach_non_followers: number
}

// Insights de cuenta del día (best-effort: distintas cuentas soportan distintas métricas).
export async function fetchAccountInsights(cfg: IgConfig, igId: string): Promise<AccountInsights> {
  const out: AccountInsights = {
    reach: 0,
    profile_views: 0,
    new_follows: 0,
    unfollows: 0,
    reach_followers: 0,
    reach_non_followers: 0,
  }

  // reach + profile_views (period=day)
  try {
    const url = `${GRAPH}/${cfg.version}/${igId}/insights?metric=reach,profile_views&period=day&${q(cfg)}`
    const j = await graphGet(url)
    for (const row of j?.data || []) {
      const v = row?.total_value?.value ?? row?.values?.[0]?.value ?? 0
      if (row?.name === 'reach') out.reach = Number(v) || 0
      if (row?.name === 'profile_views') out.profile_views = Number(v) || 0
    }
  } catch {
    /* */
  }

  // follows_and_unfollows (métrica nueva, requiere metric_type=total_value)
  try {
    const url = `${GRAPH}/${cfg.version}/${igId}/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&${q(cfg)}`
    const j = await graphGet(url)
    const row = j?.data?.[0]
    const results = row?.total_value?.breakdowns?.[0]?.results || []
    for (const r of results) {
      const key = String(r?.dimension_values?.[0] || '').toLowerCase()
      const v = Number(r?.value) || 0
      if (key.includes('unfollow')) out.unfollows = v
      else if (key.includes('follow')) out.new_follows = v
    }
    if (!results.length) out.new_follows = Number(row?.total_value?.value) || 0
  } catch {
    /* */
  }

  return out
}

export type DemographicRow = { dimension: string; bucket: string; value: number }

// Demografía de seguidores (país/ciudad/edad/género). Requiere >=100 seguidores.
export async function fetchFollowerDemographics(cfg: IgConfig, igId: string): Promise<DemographicRow[]> {
  const breakdowns: Array<{ bd: string; dim: string }> = [
    { bd: 'country', dim: 'country' },
    { bd: 'city', dim: 'city' },
    { bd: 'age', dim: 'age' },
    { bd: 'gender', dim: 'gender' },
  ]
  const rows: DemographicRow[] = []
  for (const { bd, dim } of breakdowns) {
    try {
      const url = `${GRAPH}/${cfg.version}/${igId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${bd}&${q(cfg)}`
      const j = await graphGet(url)
      const results = j?.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
      for (const r of results) {
        const bucket = String(r?.dimension_values?.[0] ?? '')
        const value = Number(r?.value) || 0
        if (bucket) rows.push({ dimension: dim, bucket, value })
      }
    } catch {
      /* dimensión no disponible */
    }
  }
  return rows
}

type IgComment = {
  external_id: string
  media_external_id: string
  username?: string
  text?: string
  like_count: number
  commented_at?: string
}

// ── Facebook: la misma cuenta cross-postea sus reels a la página de FB ────────
// Resolvemos la página cuyo instagram_business_account coincide con IG_USER_ID,
// derivamos su Page Access Token y leemos sus reels con métricas propias de FB
// (views/likes/comments). Se emparejan con los reels de IG por created_time+caption.

// Devuelve el id de la página de FB vinculada a la cuenta IG. Usa el IG_PAGE_ID configurado en la
// subcuenta si lo hay; si no, lo busca por /me/accounts casando el instagram_business_account.
export async function resolveFbPageId(cfg: IgConfig, igUserId: string): Promise<string | null> {
  if (cfg.pageId) return cfg.pageId
  const url = `${GRAPH}/${cfg.version}/me/accounts?fields=instagram_business_account{id}&limit=100&${q(cfg)}`
  const pages = await graphGetAll(url)
  for (const p of pages) {
    if (leerAnidado(p?.instagram_business_account, 'id') === String(igUserId)) {
      return String(p.id)
    }
  }
  return null
}

// Page Access Token (necesario para leer reels/insights/conversaciones de la página).
export async function getPageAccessToken(cfg: IgConfig, pageId: string): Promise<string | null> {
  const j = await graphGet(`${GRAPH}/${cfg.version}/${pageId}?fields=access_token&${q(cfg)}`)
  return j?.access_token ? String(j.access_token) : null
}

export type FbReel = {
  external_id: string
  description?: string
  permalink?: string
  created_time?: string
  views: number
  likes: number
  comments: number
}

// Reels de la página de FB con sus métricas. video_insights de reels es
// inconsistente entre cuentas, así que leemos views del propio nodo y
// likes/comments por summary (fiable).
// withEngagement=false salta los summary de likes/comments por reel (1 llamada
// menos por reel) → se usa en el cron para no exceder los 60s de Vercel Hobby.
export async function fetchFacebookReels(
  cfg: IgConfig,
  pageId: string,
  pat: string,
  limit = 40,
  withEngagement = true
): Promise<FbReel[]> {
  const pq = `access_token=${encodeURIComponent(pat)}`
  const url = `${GRAPH}/${cfg.version}/${pageId}/video_reels?fields=id,description,permalink_url,created_time,views&limit=${Math.min(limit, 100)}&${pq}`
  const rows = await graphGetAll(url, Math.ceil(limit / 100) + 1)
  const out: FbReel[] = []
  for (const r of rows.slice(0, limit)) {
    const reel: FbReel = {
      external_id: String(r.id),
      description: texto(r.description),
      permalink: r.permalink_url ? `https://www.facebook.com${String(r.permalink_url)}` : undefined,
      created_time: texto(r.created_time),
      views: Number(r.views) || 0,
      likes: 0,
      comments: 0,
    }
    if (withEngagement) {
      try {
        const j = await graphGet(
          `${GRAPH}/${cfg.version}/${r.id}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)&${pq}`
        )
        reel.likes = Number(j?.likes?.summary?.total_count) || 0
        reel.comments = Number(j?.comments?.summary?.total_count) || 0
      } catch {
        /* si falla el summary, dejamos 0 */
      }
    }
    out.push(reel)
  }
  return out
}

// ── Competencia: business_discovery de un perfil público profesional ──────────
// Devuelve el perfil + sus medias con like_count/comments_count/media_url. NO da
// views de terceros (limitación de la API) → ordenamos por likes+comments.
export type CompetitorProfile = {
  username: string
  followers_count: number
  media_count: number
}
export type CompetitorMedia = {
  external_id: string
  caption?: string
  media_type?: string
  media_product_type?: string
  like_count: number
  comments_count: number
  permalink?: string
  media_url?: string
  thumbnail_url?: string
  timestamp?: string
}

export async function fetchBusinessDiscovery(
  cfg: IgConfig,
  igUserId: string,
  username: string,
  mediaLimit = 50
): Promise<{ profile: CompetitorProfile; media: CompetitorMedia[] }> {
  const uname = username.trim().replace(/^@/, '')
  const mediaFields =
    'id,caption,media_type,media_product_type,like_count,comments_count,permalink,media_url,thumbnail_url,timestamp'
  const url = `${GRAPH}/${cfg.version}/${igUserId}?fields=business_discovery.username(${encodeURIComponent(uname)}){username,followers_count,media_count,media.limit(${Math.min(mediaLimit, 50)}){${mediaFields}}}&${q(cfg)}`
  const j = await graphGet(url)
  const bd = j?.business_discovery
  if (!bd) throw new Error(`No se pudo leer @${uname}. Debe ser una cuenta profesional pública (creador/empresa).`)
  const media: CompetitorMedia[] = (bd.media?.data || []).map((r: FilaGraph) => ({
    external_id: String(r.id),
    caption: r.caption,
    media_type: r.media_type,
    media_product_type: r.media_product_type,
    like_count: Number(r.like_count) || 0,
    comments_count: Number(r.comments_count) || 0,
    permalink: r.permalink,
    media_url: r.media_url,
    thumbnail_url: r.thumbnail_url,
    timestamp: r.timestamp,
  }))
  return {
    profile: {
      username: bd.username || uname,
      followers_count: Number(bd.followers_count) || 0,
      media_count: Number(bd.media_count) || 0,
    },
    media,
  }
}

// Refresca la media_url de UN media propio (las URLs firmadas de la CDN de Meta
// caducan a las pocas horas). Solo funciona para media de la cuenta propia.
export async function refreshOwnMediaUrl(cfg: IgConfig, externalId: string): Promise<string | null> {
  const url = `${GRAPH}/${cfg.version}/${externalId}?fields=media_url&${q(cfg)}`
  const j = await graphGet(url)
  return j?.media_url || null
}

export type ConversationStats = {
  total_conversations: number
  unread_conversations: number
  total_messages: number
  unique_people: number
}

// Conversaciones (DMs) por polling — fase 3. Requiere scope instagram_manage_messages
// y un PAGE Access Token (el token del System User da #190). pageId = página de FB
// vinculada a la cuenta IG (platform=instagram).
export async function fetchConversationStats(cfg: IgConfig, pageId: string, pat?: string): Promise<ConversationStats> {
  const auth = pat ? `access_token=${encodeURIComponent(pat)}` : q(cfg)
  // Pedir participants para todas las conversaciones da error #1 ("reduce data").
  // Nos quedamos con lo esencial (nº de conversaciones, no leídas, mensajes) con
  // páginas pequeñas. unique_people no está disponible en modo ligero.
  const url = `${GRAPH}/${cfg.version}/${pageId}/conversations?platform=instagram&fields=message_count,unread_count,updated_time&limit=50&${auth}`
  const rows = await graphGetAll(url, 20)
  let unread = 0
  let messages = 0
  for (const c of rows) {
    messages += Number(c?.message_count) || 0
    if ((Number(c?.unread_count) || 0) > 0) unread++
  }
  return {
    total_conversations: rows.length,
    unread_conversations: unread,
    total_messages: messages,
    unique_people: 0,
  }
}

type IgConversationMessage = { from: 'agente' | 'lead'; text?: string; created_time?: string }
export type IgConversation = {
  id: string
  participant?: string
  updated_time?: string
  unread_count: number
  message_count: number
  messages: IgConversationMessage[]
}

// Conversaciones (DMs) CON su transcripción — fase 4 (extracción para análisis con IA del
// proceso de setting). A diferencia de fetchConversationStats (solo contadores agregados
// porque pedir "participants" en el listado da error #1 de Meta), aquí pedimos el detalle
// (participants + mensajes) conversación a conversación, que sí lo admite.
export async function fetchIgConversationsWithMessages(
  cfg: IgConfig,
  pageId: string,
  pat: string,
  igUserId: string,
  limit = 20,
  // 12s: los detalles que no lleguen se degradan (la UI lo dice) y la ruta responde holgada
  // bajo su plazo duro de 25s — con 40s el detalle comía el plazo entero y ganaba el deadline.
  presupuestoMs = 12_000
): Promise<IgConversation[]> {
  const inicio = Date.now()
  const agotado = () => Date.now() - inicio > presupuestoMs
  const pq = `access_token=${encodeURIComponent(pat)}`
  const urlListado = (n: number) =>
    `${GRAPH}/${cfg.version}/${pageId}/conversations?platform=instagram&fields=updated_time,unread_count,message_count&limit=${Math.min(n, 50)}&${pq}`

  // El endpoint de conversaciones de Meta es más pesado que el resto de la Graph API: en
  // algunas páginas responde error #1 ("reduce data") o supera el timeout. Un reintento
  // con página más pequeña lo salva la mayoría de las veces sin tocar al usuario.
  let rows: FilaGraph[]
  try {
    rows = await graphGetAll(urlListado(limit), Math.ceil(limit / 50) + 1)
  } catch (e) {
    if (agotado() || !(e instanceof InstagramApiError)) throw e
    rows = await graphGetAll(urlListado(Math.min(limit, 10)), Math.ceil(limit / 50) + 1)
  }
  const seleccion = rows.slice(0, limit)

  // El detalle (participants + mensajes) exige UNA llamada por conversación. En serie eran
  // `limit` × (0,5-2s) = decenas de segundos: la pantalla de Conversaciones agotaba el tiempo
  // de la lambda y el usuario veía un timeout. En paralelo con pool acotado, el muro es el de
  // UNA llamada × CONCURRENCIA (no × conversaciones), y el ritmo es sostenible para el rate
  // limit de Meta (5 en vuelo puntualmente, no 20 en ráfaga).
  const CONCURRENCIA_DETALLE = 5
  const detalle = new Map<number, { participant?: string; messages: IgConversationMessage[] }>()
  let cursor = 0
  async function worker() {
    while (cursor < seleccion.length) {
      // Sin presupuesto restante: lo no descargado queda sin transcripción (la UI lo dice)
      // en vez de mantener la lambda viva hasta que Vercel la mate a mitad de respuesta.
      if (agotado()) {
        while (cursor < seleccion.length) detalle.set(cursor++, { messages: [] })
        return
      }
      const i = cursor++
      // Si el detalle de una conversación falla, queda sin transcripción: no tumba el listado.
      const d = await detalleDe(cfg, pat, igUserId, String(seleccion[i]?.id), pq).catch(() => null)
      detalle.set(i, d ?? { messages: [] })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_DETALLE, seleccion.length) }, worker))

  return seleccion.map((c, i) => ({
    id: String(c.id),
    participant: detalle.get(i)?.participant,
    updated_time: texto(c?.updated_time),
    unread_count: Number(c?.unread_count) || 0,
    message_count: Number(c?.message_count) || 0,
    messages: detalle.get(i)?.messages ?? [],
  }))
}

/** participants + últimos 50 mensajes de UNA conversación. `null` si esa llamada falla. */
async function detalleDe(
  cfg: IgConfig,
  pat: string,
  igUserId: string,
  conversationId: string,
  pq: string
): Promise<{ participant?: string; messages: IgConversationMessage[] } | null> {
  try {
    const j = await graphGet(
      `${GRAPH}/${cfg.version}/${conversationId}?fields=participants,messages.limit(50){message,from,created_time}&${pq}`
    )
    const participants = j?.participants?.data || []
    const other = participants.find((p: FilaGraph) => String(p?.id) !== String(igUserId))
    const participant = other?.username || other?.name || other?.id
    const msgRows = j?.messages?.data || []
    const messages = msgRows
      .slice()
      .reverse()
      .map((m: FilaGraph) => ({
        from: (leerAnidado(m?.from, 'id') === String(igUserId) ? 'agente' : 'lead') as 'agente' | 'lead',
        text: texto(m?.message),
        created_time: texto(m?.created_time),
      }))
    return { participant, messages }
  } catch {
    return null
  }
}
