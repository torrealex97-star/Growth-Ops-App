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
export function canalDe(lastMessageType: unknown, tipoConversacion: unknown): string {
  const t = texto(lastMessageType) || texto(tipoConversacion) || ''
  if (t === 'TYPE_NO_SHOW') return 'call'
  if (t.startsWith('TYPE_')) return t.slice(5).toLowerCase()
  return t.toLowerCase() || 'chat'
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

// ── Snapshot stale (respaldo cuando GHL no responde) ────────────────────────────────
// Misma mecánica que lib/instagram/snapshot.ts: el ÚLTIMO resultado correcto con su edad
// declarada, nunca presentado como fresco.
export type SnapshotGhlConversaciones = {
  conversaciones: GhConversation[]
  guardado: string // ISO-8601
}

const KEY = 'ghl_conversaciones_snapshot'

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

// ── Descarga (listado + transcripciones) ────────────────────────────────────────────
// El deadline corta la FASE, no la calidad: las conversaciones ya listadas se sirven con
// las transcripciones que hayan llegado; las que falten quedan `messages: []` (la UI lo
// dice) en vez de mantener la lambda viva hasta que Vercel la mate a mitad de respuesta.
export async function descargarConversacionesGhl(
  cfg: GhConversacionesCfg,
  opts: { limite?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<GhConversation[]> {
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  const deadlineMs = opts.deadlineMs ?? Date.now() + 25_000
  const doFetch = opts.fetchImpl ?? fetch
  const agotado = () => Date.now() > deadlineMs

  const url = new URL(`${GHL_BASE}/conversations/search`)
  url.searchParams.set('locationId', cfg.locationId)
  url.searchParams.set('limit', String(limite))
  url.searchParams.set('sortBy', 'last_message_date')
  url.searchParams.set('sort', 'desc')

  if (agotado()) throw new GhlConversacionesError('Presupuesto agotado antes de listar conversaciones', 504)
  const res = await doFetch(url, { headers: ghlHeaders(cfg.token), signal: AbortSignal.timeout(20_000) })
  const body = (await res.json().catch(() => ({}))) as { conversations?: FilaSearch[]; message?: string }
  if (!res.ok) throw new GhlConversacionesError(body.message || `GHL respondió ${res.status}`, res.status)

  const conversaciones = (body.conversations ?? []).map(mapearConversacionGhl).filter((c): c is GhConversation => !!c)

  // Transcripciones: 1 llamada por conversación, en paralelo con pool acotado (igual que el
  // detalle de IG). El deadline se comprueba por trabajo; el slice del pool también acota
  // cuántas llamadas se lanzan como máximo.
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

  return conversaciones
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
