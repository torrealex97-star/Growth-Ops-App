// Conversaciones de GoHighLevel (pestaña "GHL" de Setting AI › Conversaciones).
//
// GHL es la bandeja unificada de la subcuenta: SMS, Facebook, Instagram, WhatsApp y email
// llegan a UNA API, aunque las integraciones directas de cada canal no estén conectadas.
// Aquí solo se LEE (pull bajo demanda desde el navegador, igual que Instagram); no duplica
// la ingesta de contactos/citas (`lib/integrations/citas-sync.ts`) ni inventa estados:
// una conversación sin contacto vinculado se muestra "Sin perfil", no se fuerza a uno.
//
// Dos reglas de AGENTS.md aplican tal cual:
//  · El deadline gobierna TODAS las llamadas externas: cada fetch comprueba el reloj antes
//    de ejecutarse y lo que ya se leyó se sirve aunque el resto se degrade.
//  · Un error de carga NO es un estado vacío: la ruta sirve el último snapshot correcto
//    (con su edad declarada) y, si nunca lo hubo, `configured:false` con motivo accionable.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export type GhConversationMessage = {
  from: 'agente' | 'lead'
  text?: string
  created_time?: string
}

export type PaginaGhl = {
  conversaciones: GhConversation[]
  total: number
  // Cursor a la SIGUIENTE página: epoch-ms del lastMessageDate de la última fila (sortBy
  // last_message_date + sort desc, paginación oficial por startAfterDate). undefined = no hay más.
  cursor?: number
}

export type GhConversation = {
  id: string
  participant?: string
  channel?: string
  contactId?: string
  contact_id?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  // Foto de perfil del contacto en GHL (profilePhoto del listado): la pinta el inbox con
  // fallback a iniciales. Puede ser null y la URL puede caducar — la UI tolera ambos.
  contact_photo_url?: string | null
  updated_time?: string
  unread_count: number
  message_count: number
  messages: GhConversationMessage[]
  // Vinculación con el perfil del CRM (contacts): resultado de la resolución.
  contactoVinculado?: { id: string; full_name: string } | null
  // Cómo se resolvió: 'ghl_contact_id' | 'email' | 'telefono' (declarado, nunca adivinado).
  vinculacion?: string | null
}

type Json = Record<string, unknown>
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

// GHL mezcla formatos de fecha: el listado de conversaciones trae epoch en MILISEGUNDOS
// (observado en producción 29-sep: lastMessageDate: number) y las transcripciones traen
// ISO-8601 en texto. <10^11 se interpreta como segundos (fecha actual: ms ≈ 1.8×10¹²);
// lo que no se puede fechar queda undefined, nunca inventado.
export function aIsoFecha(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Math.abs(v) < 1e11 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  const s = texto(v)
  return s && !Number.isNaN(Date.parse(s)) ? s : undefined
}

// Sin parameter properties (readonly en constructor): el runtime local (node 26, strip-only)
// no las transforma y el módulo dejaría de importarse en tests — lección apify del 27-sep.
export class GhlConversacionesError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GhlConversacionesError'
    this.status = status
  }
}

export type GhConversacionesCfg = {
  token: string
  locationId: string
}

export function cfgDesdeEnv(env: Record<string, string | undefined>): GhConversacionesCfg | null {
  const token = env.GHL_API_TOKEN?.trim()
  const locationId = env.GHL_LOCATION_ID?.trim()
  return token && locationId ? { token, locationId } : null
}

export function ghlHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: 'application/json' }
}

// Mapea el tipo del último mensaje / de la conversación a un canal legible. Sin traducción
// inventada: lo que GHL no dice queda como 'chat'. Excepción observada en producción
// (29-sep, sonda sobre 20 conversaciones reales): la llamada perdida llega como
// TYPE_NO_SHOW (conversación TYPE_PHONE, messageTypes [100]) — el canal es 'call'.
// TikTok llega como TYPE_TIKTOK y cae en el slice genérico → 'tiktok' (canal legible sin caso extra).
export function canalDe(lastMessageType: unknown, tipoConversacion: unknown): string {
  const t = texto(lastMessageType) || texto(tipoConversacion) || ''
  if (t === 'TYPE_NO_SHOW') return 'call'
  if (t.startsWith('TYPE_')) return t.slice(5).toLowerCase()
  return t.toLowerCase() || 'chat'
}

// Canal GHL → tipo de mensaje de POST /conversations/messages (doc 2021-07-28, scope
// conversations/message.write): la conversación ya existe, así que el envío por su canal es una
// correspondencia directa. Custom/Live_Chat/InternalComment no son respuestas al lead: fuera.
export function typeDe(canal: string): 'SMS' | 'Email' | 'WhatsApp' | 'IG' | 'FB' {
  switch (canal) {
    case 'email':
      return 'Email'
    case 'whatsapp':
      return 'WhatsApp'
    case 'instagram':
      return 'IG'
    case 'facebook':
      return 'FB'
    default:
      return 'SMS' // sms y call (respuesta escrita tras llamada perdida) salen por SMS
  }
}

type FilaSearch = {
  id?: unknown
  contactId?: unknown
  fullName?: unknown
  contactName?: unknown
  email?: unknown
  phone?: unknown
  lastMessageBody?: unknown
  lastMessageType?: unknown
  type?: unknown
  unreadCount?: unknown
  lastMessageDate?: unknown
  profilePhoto?: unknown
}

// PURO: sobre la respuesta de `GET /conversations/search` (API v2 2021-07-28).
// Los mensajes NO están aquí: el listado da la cabecera de cada conversación y la
// transcripción se pide conversación a conversación (ver descargarMensajes).
export function mapearConversacionGhl(row: FilaSearch): GhConversation | null {
  const id = texto(row.id)
  if (!id) return null
  return {
    id,
    participant: texto(row.fullName) || texto(row.contactName) || texto(row.email) || texto(row.phone),
    channel: canalDe(row.lastMessageType, row.type),
    contactId: texto(row.contactId),
    contact_email: texto(row.email) || null,
    contact_phone: texto(row.phone) || null,
    contact_photo_url: texto(row.profilePhoto) ?? null,
    unread_count: Number(row.unreadCount) || 0,
    message_count: 0,
    updated_time: aIsoFecha(row.lastMessageDate),
    messages: [],
  }
}

type FilaMensaje = {
  id?: unknown
  body?: unknown
  direction?: unknown
  dateAdded?: unknown
  messageType?: unknown
}

// PURO: sobre la respuesta de `GET /conversations/{id}/messages`. `inbound` es el lead;
// todo lo demás (outbound, automated, workflow) es el equipo/agente. Mensajes sin cuerpo
// (llamadas, notas de actividad) se conservan con un placeholder honesto, no se inventan.
export function mapearMensajesGhl(j: Json | null): GhConversationMessage[] {
  const wrapper = (j?.messages ?? null) as Json | null
  const rows = (Array.isArray(wrapper) ? wrapper : (wrapper?.messages as unknown[] | undefined)) ?? []
  return (
    rows
      .map((raw): GhConversationMessage | null => {
        const m = (raw ?? {}) as FilaMensaje
        return {
          from: m.direction === 'inbound' ? 'lead' : 'agente',
          text: texto(m.body) || `(${texto(m.messageType) || 'mensaje'} sin texto)`,
          created_time: texto(m.dateAdded),
        }
      })
      .filter((m): m is GhConversationMessage => m !== null)
      // Orden cronológico por fecha (estable): GHL no garantiza el orden del listado y la UI
      // renderiza de arriba abajo; sin fecha queda en su posición relativa, nunca inventada.
      .sort((a, b) => (Date.parse(a.created_time || '') || 0) - (Date.parse(b.created_time || '') || 0))
  )
}

// ── Listado por páginas (cursor startAfterDate) ────────────────────────────────────
// El deadline gobierna TODAS las llamadas externas (AGENTS.md): se piden páginas hasta
// agotar presupuesto o cubrir `objetivo`; lo ya leído se devuelve SIEMPRE con el cursor a
// la siguiente, para que "Cargar más" continúe donde quedó en vez de empezar de cero.
// Duplicados por id se eliminan conservando el primero (empates de fecha en el cursor).
export async function descargarPaginaConversacionesGhl(
  cfg: GhConversacionesCfg,
  opts: {
    pagina?: number
    cursor?: number
    objetivo?: number
    deadlineMs?: number
    fetchImpl?: typeof fetch
    transcripciones?: boolean
  } = {}
): Promise<PaginaGhl> {
  const PAGINA = Math.min(Math.max(opts.pagina ?? 25, 1), 100)
  const objetivo = Math.max(opts.objetivo ?? PAGINA, PAGINA)
  const deadlineMs = opts.deadlineMs ?? Date.now() + 25_000
  const doFetch = opts.fetchImpl ?? fetch
  const pedirTranscripciones = opts.transcripciones ?? true
  const agotado = () => Date.now() > deadlineMs

  const conversaciones: GhConversation[] = []
  const vistos = new Set<string>()
  let cursor = opts.cursor
  let total = 0
  let resultado: PaginaGhl = { conversaciones, total: 0, cursor: opts.cursor }

  while (conversaciones.length < objetivo) {
    if (agotado()) {
      // Presupuesto agotado ANTES de la primera página: error (nunca una lista vacía que
      // parezca "no hay conversaciones" — un hueco no es un cero). Con páginas ya leídas:
      // lo leído se devuelve con su cursor de continuación; el siguiente intento sigue ahí.
      if (conversaciones.length === 0)
        throw new GhlConversacionesError('Presupuesto agotado antes de listar conversaciones', 504)
      resultado = { conversaciones, total, cursor }
      break
    }
    const url = new URL(`${GHL_BASE}/conversations/search`)
    url.searchParams.set('locationId', cfg.locationId)
    url.searchParams.set('limit', String(PAGINA))
    url.searchParams.set('sortBy', 'last_message_date')
    url.searchParams.set('sort', 'desc')
    if (cursor !== undefined) url.searchParams.set('startAfterDate', String(cursor))

    const res = await doFetch(url, { headers: ghlHeaders(cfg.token), signal: AbortSignal.timeout(20_000) })
    const body = (await res.json().catch(() => ({}))) as {
      conversations?: FilaSearch[]
      total?: unknown
      message?: string
    }
    if (!res.ok) throw new GhlConversacionesError(body.message || `GHL respondió ${res.status}`, res.status)
    if (typeof body.total === 'number' && Number.isFinite(body.total)) total = body.total

    const filas = (body.conversations ?? []).map(mapearConversacionGhl).filter((c): c is GhConversation => !!c)
    if (filas.length === 0) {
      // Página vacía: fin real del listado, sin cursor — no se ofrece un "cargar más" hueco.
      resultado = { conversaciones, total, cursor: undefined }
      break
    }

    const ultima = filas[filas.length - 1]
    const nuevoCursor = aIsoFecha(ultima.updated_time) ? Date.parse(ultima.updated_time!) : undefined
    const sinNuevos = filas.every((c) => vistos.has(c.id))
    for (const c of filas) {
      if (vistos.has(c.id)) continue
      vistos.add(c.id)
      conversaciones.push(c)
    }
    // Página corta (fin real) o página repetida (cursor sin avance): parar sin cursor —
    // nunca un "cargar más" que vuelva a dar lo mismo.
    if (filas.length < PAGINA || sinNuevos || nuevoCursor === undefined) {
      resultado = { conversaciones, total, cursor: undefined }
      break
    }
    cursor = nuevoCursor
    if (conversaciones.length >= objetivo) {
      // Objetivo cubierto: hay "cargar más" si el total declarado aún excede lo leído — o si
      // GHL no declaró total (se descubre en la siguiente petición; una página vacía cierra).
      const quedan = total === 0 || conversaciones.length < total
      resultado = { conversaciones, total, cursor: quedan ? cursor : undefined }
      break
    }
  }

  if (pedirTranscripciones && conversaciones.length)
    await completarTranscripcionesGhl(cfg, conversaciones, { deadlineMs, fetchImpl: doFetch })
  return resultado
}

// ── Snapshot stale (respaldo cuando GHL no responde) ────────────────────────────────
// Misma mecánica que lib/instagram/snapshot.ts: el ÚLTIMO resultado correcto con su edad
// declarada, nunca presentado como fresco.
export type SnapshotGhlConversaciones = {
  conversaciones: GhConversation[]
  guardado: string // ISO-8601
}

const KEY = 'ghl_conversaciones_snapshot'
// Posición de paginación persistida junto al snapshot: hasta dónde llegó el usuario cuando
// la bandeja supera lo que cabe en un primer pull.
const KEY_CURSOR = 'ghl_conversaciones_cursor'

function cliente(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function guardarSnapshotGhl(tenantId: string, conversaciones: GhConversation[]): Promise<void> {
  try {
    const sb = cliente()
    await sb
      .from('integration_settings')
      .upsert(
        {
          tenant_id: tenantId,
          key: KEY,
          value: JSON.stringify({ conversaciones, guardado: new Date().toISOString() }),
          is_secret: false,
          label: 'Snapshot del listado de conversaciones de GHL (respaldo cuando GHL no responde)',
        },
        { onConflict: 'tenant_id,key' }
      )
      .select('key')
  } catch {
    // Silencioso por diseño: el snapshot es una optimización, no un requisito.
  }
}

export async function leerSnapshotGhl(tenantId: string): Promise<SnapshotGhlConversaciones | null> {
  try {
    const sb = cliente()
    const { data } = await sb
      .from('integration_settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', KEY)
      .maybeSingle()
    if (!data?.value) return null
    const j = JSON.parse((data as { value: string }).value) as SnapshotGhlConversaciones
    if (!Array.isArray(j.conversaciones) || typeof j.guardado !== 'string') return null
    return j
  } catch {
    return null
  }
}

// Cursor de paginación del usuario: cuántas filas había ya cargadas y por dónde quedó la
// descarga (epoch-ms de lastMessageDate). Igual de silencioso que el snapshot: perderlo solo
// devuelve el "Cargar más" al principio, no rompe nada.
export async function guardarCursorGhl(
  tenantId: string,
  cursor: { cargadas: number; startAfterDate?: number; total?: number }
): Promise<void> {
  try {
    const sb = cliente()
    await sb
      .from('integration_settings')
      .upsert(
        {
          tenant_id: tenantId,
          key: KEY_CURSOR,
          value: JSON.stringify({ ...cursor, guardado: new Date().toISOString() }),
          is_secret: false,
          label:
            'Posición de paginación de la bandeja de GHL (cuántas conversaciones cargadas y cursor a la siguiente página)',
        },
        { onConflict: 'tenant_id,key' }
      )
      .select('key')
  } catch {
    // Silencioso por diseño: el cursor es una optimización, no un requisito.
  }
}

export async function leerCursorGhl(
  tenantId: string
): Promise<{ cargadas: number; startAfterDate?: number; total?: number } | null> {
  try {
    const sb = cliente()
    const { data } = await sb
      .from('integration_settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', KEY_CURSOR)
      .maybeSingle()
    if (!data?.value) return null
    const j = JSON.parse((data as { value: string }).value) as {
      cargadas?: unknown
      startAfterDate?: unknown
      total?: unknown
    }
    if (typeof j.cargadas !== 'number' || !Number.isFinite(j.cargadas)) return null
    return {
      cargadas: j.cargadas,
      startAfterDate:
        typeof j.startAfterDate === 'number' && Number.isFinite(j.startAfterDate) ? j.startAfterDate : undefined,
      total: typeof j.total === 'number' && Number.isFinite(j.total) ? j.total : undefined,
    }
  } catch {
    return null
  }
}

// ── Descarga (listado + transcripciones) ────────────────────────────────────────────
export async function descargarConversacionesGhl(
  cfg: GhConversacionesCfg,
  opts: { limite?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<GhConversation[]> {
  // Contrato legacy de la pestaña: UNA página de `limite` (20) con sus transcripciones —
  // misma implementación canónica que la paginada: misma URL, mismo deadline, mismo pool.
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  const { conversaciones } = await descargarPaginaConversacionesGhl(cfg, {
    pagina: limite,
    objetivo: limite,
    deadlineMs: opts.deadlineMs,
    fetchImpl: opts.fetchImpl,
  })
  return conversaciones
}

// ── Envío de respuesta al lead (inbox saliente) ────────────────────────────────
// POST /conversations/messages (doc 2021-07-28): el mensaje sale por el canal de la
// conversación (typeDe) al contacto de la conversación. Efecto externo IRREVERSIBLE: la ruta
// del inbox valida auth/tenant; aquí solo el contrato de GHL. Devuelve el messageId (traza
// para soporte); un error HTTP de GHL se propaga con su mensaje real, nunca en silencio.
export async function enviarMensajeGhl(
  cfg: GhConversacionesCfg,
  params: { conversacionId: string; contactId: string; canal: string; texto: string },
  fetchImpl: typeof fetch = fetch
): Promise<{ messageId: string | null }> {
  const mensaje = texto(params.texto)
  if (!mensaje) throw new GhlConversacionesError('El mensaje está vacío', 400)
  if (!params.contactId)
    throw new GhlConversacionesError('Esta conversación no tiene contacto de GHL: no se puede responder', 400)
  const res = await fetchImpl(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(cfg.token),
    body: JSON.stringify({
      type: typeDe(params.canal),
      contactId: params.contactId,
      message: mensaje,
      status: 'delivered',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json().catch(() => ({}))) as { messageId?: unknown; message?: string }
  if (!res.ok) throw new GhlConversacionesError(body.message || `GHL respondió ${res.status} al enviar`, res.status)
  return { messageId: texto(body.messageId) ?? null }
}

/** Últimos 50 mensajes de UNA conversación. Lanza solo si GHL responde con error HTTP. */
async function descargarMensajes(
  cfg: GhConversacionesCfg,
  conversationId: string,
  doFetch: typeof fetch
): Promise<GhConversationMessage[]> {
  const res = await doFetch(`${GHL_BASE}/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`, {
    headers: ghlHeaders(cfg.token),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string }
    throw new GhlConversacionesError(j.message || `GHL mensajes respondió ${res.status}`, res.status)
  }
  return mapearMensajesGhl((await res.json().catch(() => ({}))) as Json)
}

// Transcripciones de un lote de conversaciones ya listadas: 1 llamada por conversación, en
// paralelo con pool acotado (igual que el detalle de IG). El deadline se comprueba por
// trabajo: lo que no llegue queda `messages: []` (la UI lo dice) en vez de mantener la
// lambda viva hasta que Vercel la mate a mitad de respuesta.
async function completarTranscripcionesGhl(
  cfg: GhConversacionesCfg,
  conversaciones: GhConversation[],
  opts: { deadlineMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const deadlineMs = opts.deadlineMs ?? Date.now() + 25_000
  const doFetch = opts.fetchImpl ?? fetch
  const agotado = () => Date.now() > deadlineMs
  const CONCURRENCIA = 5
  let cursor = 0
  async function worker() {
    while (cursor < conversaciones.length) {
      if (agotado()) {
        while (cursor < conversaciones.length) cursor++
        return
      }
      const c = conversaciones[cursor++]
      if (!c) return
      try {
        c.messages = await descargarMensajes(cfg, c.id, doFetch)
        c.message_count = c.messages.length
      } catch {
        // Sin transcripción para esta conversación: no tumba el listado.
        c.message_count = 0
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, conversaciones.length) }, worker))
}

// ── Fusión de páginas (paginación incremental) ──────────────────────────────────────
// La bandeja acumula páginas: snapshot previo + filas recién leídas, SIN duplicados (una
// conversación puede reaparecer en la zona de solape del cursor) y ordenadas por
// updated_time desc. Las filas FRESCAS ganan sobre las guardadas: unreadCount y último
// mensaje actualizados. El tope acota el respaldo; recortar las más antiguas no inventa
// datos — la UI declara siempre lo que hay cargado.
export function fusionarConversaciones(
  previas: GhConversation[],
  nuevas: GhConversation[],
  tope = 300
): GhConversation[] {
  const porId = new Map<string, GhConversation>()
  for (const c of previas) porId.set(c.id, c)
  for (const c of nuevas) porId.set(c.id, c)
  return [...porId.values()]
    .sort((a, b) => (Date.parse(b.updated_time || '') || 0) - (Date.parse(a.updated_time || '') || 0))
    .slice(0, tope)
}

// El cursor que MANDA es el más profundo (la fecha más antigua alcanzada): con sort desc,
// "más profundo" es el número MENOR. Un refresco que trae páginas más recientes nunca
// retrocede la posición de "Cargar más".
export function cursorMasProfundo(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

// ── Vinculación con perfiles (contacts) ─────────────────────────────────────────────
// SOLO lectura. Precedencia idéntica a findOrCreateContact (lib/integrations/citas-sync.ts):
// ghl_contact_id → email → teléfono. Si no hay match, queda null (la UI muestra "Sin
// perfil"): ante la duda NO se elige un candidato "por si acaso".
export type ContactoVinculo = {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  ghl_contact_id: string | null
}

export async function vincularConContactos(
  sb: SupabaseClient,
  tenantId: string,
  conversaciones: GhConversation[]
): Promise<GhConversation[]> {
  if (conversaciones.length === 0) return conversaciones

  const ghlIds = [...new Set(conversaciones.map((c) => c.contactId).filter((v): v is string => !!v))]
  const emails = [...new Set(conversaciones.map((c) => c.contact_email?.toLowerCase()).filter((v): v is string => !!v))]
  const phones = [...new Set(conversaciones.map((c) => c.contact_phone).filter((v): v is string => !!v))]

  const porGhlId = new Map<string, ContactoVinculo>()
  if (ghlIds.length) {
    const { data, error } = await sb
      .from('contacts')
      .select('id, full_name, email, phone, ghl_contact_id')
      .eq('tenant_id', tenantId)
      .in('ghl_contact_id', ghlIds)
      .limit(1000)
    if (error) throw new Error(`contacts por ghl_contact_id: ${error.message}`)
    for (const row of (data ?? []) as ContactoVinculo[]) {
      if (row.ghl_contact_id) porGhlId.set(row.ghl_contact_id, row)
    }
  }
  const porEmail = new Map<string, ContactoVinculo>()
  if (emails.length) {
    const { data, error } = await sb
      .from('contacts')
      .select('id, full_name, email, phone, ghl_contact_id')
      .eq('tenant_id', tenantId)
      .in('email', emails)
      .limit(1000)
    if (error) throw new Error(`contacts por email: ${error.message}`)
    for (const row of (data ?? []) as ContactoVinculo[]) {
      if (row.email) porEmail.set(row.email.toLowerCase(), row)
    }
  }
  const porTelefono = new Map<string, ContactoVinculo>()
  if (phones.length) {
    const { data, error } = await sb
      .from('contacts')
      .select('id, full_name, email, phone, ghl_contact_id')
      .eq('tenant_id', tenantId)
      .in('phone', phones)
      .limit(1000)
    if (error) throw new Error(`contacts por teléfono: ${error.message}`)
    for (const row of (data ?? []) as ContactoVinculo[]) {
      if (row.phone) porTelefono.set(row.phone, row)
    }
  }

  for (const c of conversaciones) {
    const porId = c.contactId ? porGhlId.get(c.contactId) : undefined
    const porMail = c.contact_email ? porEmail.get(c.contact_email.toLowerCase()) : undefined
    const porTel = c.contact_phone ? porTelefono.get(c.contact_phone) : undefined
    const elegido = porId ?? porMail ?? porTel
    c.contactoVinculado = elegido ? { id: elegido.id, full_name: elegido.full_name } : null
    c.vinculacion = elegido ? (porId ? 'ghl_contact_id' : porMail ? 'email' : 'telefono') : null
  }
  return conversaciones
}

// Mensajes mínimos para el análisis IA de Setting AI (mismo shape que Instagram envía).
export function conversacionParaAnalizar(c: GhConversation) {
  return c.messages.map((m) => ({
    who: m.from === 'agente' ? ('agent' as const) : ('lead' as const),
    text: m.text || '',
  }))
}
