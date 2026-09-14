// Cliente ligero de la API de Calendly (Scheduling API).
// Cuenta madre: usamos el Personal Access Token de la cuenta que invita a los
// closers a los calendarios. Con él resolvemos el usuario de Calendly de cada
// closer por su email, su event type y sus huecos disponibles, y creamos
// invitees (reservas) programáticamente.
//
// Docs: https://developer.calendly.com/api-docs/p3ghrxrwbl8kqe-create-event-invitee

import { mapKey, slugify } from './qualification'

const API = 'https://api.calendly.com'

export class CalendlyError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    const detail =
      (body as { message?: string; details?: Array<{ message?: string }> } | null)?.message ||
      (body as { details?: Array<{ message?: string }> } | null)?.details?.[0]?.message ||
      `HTTP ${status}`
    super(detail)
    this.name = 'CalendlyError'
    this.status = status
    this.body = body
  }
}

/**
 * Token de Calendly de la subcuenta que hace la llamada. Se pasa EXPLÍCITAMENTE: leerlo de
 * `process.env` significaba ignorar el token que el usuario había guardado en Configuración ›
 * Integraciones (el panel lo daba por conectado, pero agendar seguía usando el del entorno de
 * Vercel… o el de otra subcuenta, si `ensureConfig` lo había volcado antes en el mismo proceso).
 */
export function requireCalendlyToken(configured: string | undefined | null): string {
  const t = (configured ?? '').trim()
  if (!t) {
    throw new CalendlyError(400, {
      message: 'Falta el API Token de Calendly en Configuración › Integraciones.',
    })
  }
  return t
}

async function cf<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${API}${path}`
  // Timeout duro: sin esto, si Calendly va lento la petición se cuelga hasta el
  // límite de la función (~60s) y en la UI el botón se queda "cargando" eternamente.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CalendlyError(504, { message: 'Calendly tardó demasiado en responder. Inténtalo de nuevo.' })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let json: unknown = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  if (!res.ok) throw new CalendlyError(res.status, json)
  return json as T
}

type Me = { resource: { uri: string; current_organization: string; email: string; name: string } }

export type CalendlyEventType = {
  uri: string
  name: string
  duration: number
  scheduling_url: string
  active: boolean
  secret: boolean
  // location_configurations viene en el detalle del event type
  location_configurations?: Array<{ kind: string; location?: string; phone_number?: string; additional_info?: string }>
  // custom_questions viene en el detalle del event type; hay que responder las obligatorias al reservar por API
  custom_questions?: Array<{
    name: string
    type: string // 'string' | 'text' | 'phone_number' | 'single_select' | 'multi_select'
    position: number
    enabled: boolean
    required: boolean
    answer_choices?: string[]
    include_other?: boolean
  }>
}

export type CalendlySlot = { start_time: string; status: string; scheduling_url?: string }

// Caché POR TOKEN. Antes era un único `cachedMe` de módulo: con dos subcuentas y dos cuentas de
// Calendly distintas, la segunda recibía el "yo" de la primera y buscaba a sus closers en la
// organización equivocada.
const cachedMeByToken = new Map<string, Me['resource']>()
async function me(token: string): Promise<Me['resource']> {
  const hit = cachedMeByToken.get(token)
  if (hit) return hit
  const d = await cf<Me>(token, '/users/me')
  cachedMeByToken.set(token, d.resource)
  return d.resource
}

// Resuelve el URI del usuario de Calendly del closer a partir de su email,
// buscándolo entre los miembros de la organización madre.
async function findUserUriByEmail(token: string, email: string): Promise<string | null> {
  const org = (await me(token)).current_organization
  const q = `/organization_memberships?organization=${encodeURIComponent(org)}&email=${encodeURIComponent(email)}&count=1`
  const d = await cf<{ collection: Array<{ user: { uri: string; email: string } }> }>(token, q)
  const m = d.collection?.[0]
  if (m?.user?.uri) return m.user.uri
  // Fallback: la cuenta madre puede ser el propio closer (owner del token).
  const self = await me(token)
  if (self.email?.toLowerCase() === email.toLowerCase()) return self.uri
  return null
}

// Devuelve el event type activo del closer (con el detalle de location).
export async function resolveCloserEventType(token: string, email: string): Promise<CalendlyEventType | null> {
  const userUri = await findUserUriByEmail(token, email)
  if (!userUri) return null
  const d = await cf<{ collection: CalendlyEventType[] }>(
    token,
    `/event_types?user=${encodeURIComponent(userUri)}&active=true&count=100`
  )
  const list = (d.collection || []).filter((t) => t.active && !t.secret)
  const chosen = list[0] || (d.collection || [])[0]
  if (!chosen) return null
  // Traemos el detalle para conocer location_configurations.
  const uuid = chosen.uri.split('/').pop()
  try {
    const detail = await cf<{ resource: CalendlyEventType }>(token, `/event_types/${uuid}`)
    return { ...chosen, ...detail.resource }
  } catch {
    return chosen
  }
}

// Huecos disponibles del event type entre start y end (máx 7 días por petición).
export async function getAvailableTimes(
  token: string,
  eventTypeUri: string,
  startISO: string,
  endISO: string
): Promise<CalendlySlot[]> {
  const q =
    `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}` +
    `&start_time=${encodeURIComponent(startISO)}&end_time=${encodeURIComponent(endISO)}`
  const d = await cf<{ collection: CalendlySlot[] }>(token, q)
  return (d.collection || []).filter((s) => s.status === 'available')
}

// Construye el objeto location válido a partir de la config del event type.
// Para tipos que exigen input del invitee usamos los datos del contacto.
function buildLocation(et: CalendlyEventType, invitee: { phone?: string | null }): Record<string, string> | undefined {
  const cfgs = et.location_configurations || []
  if (cfgs.length === 0) return undefined // el event type no define location → se omite
  const c = cfgs[0]
  const kind = c.kind
  if (kind === 'outbound_call') return { kind, location: invitee.phone || '' }
  if (kind === 'ask_invitee') return { kind, location: invitee.phone || 'Por confirmar' }
  if (kind === 'physical' || kind === 'custom') return { kind, location: c.location || 'Por confirmar' }
  return { kind } // google_conference, zoom_conference, gotomeeting, microsoft_teams_conference, inbound_call...
}

// Elige una respuesta válida para una pregunta obligatoria del event type.
// - selects: primera opción disponible.
// - teléfono: el del contacto (o placeholder si no hay).
// - texto: el nombre del invitado como respuesta no vacía.
// Es el ÚLTIMO recurso: solo se usa cuando no hay una respuesta real previa para esa
// pregunta (ver `resolveAnswerFor`). Si se usa en una reagenda, los datos de cualificación
// del lead quedan corruptos (bug detectado con la reagenda de Alberto: el closer reagendó
// desde la app y esto pisó las respuestas reales del formulario con "Por confirmar").
function defaultAnswerFor(
  q: { name: string; type: string; answer_choices?: string[] },
  invitee: { name: string; phone?: string | null }
): string {
  if (Array.isArray(q.answer_choices) && q.answer_choices.length > 0) return q.answer_choices[0]
  const looksPhone = q.type === 'phone_number' || /phone|tel[eé]fono|whats|m[oó]vil/i.test(q.name)
  if (looksPhone) return invitee.phone || 'Por confirmar'
  return invitee.name || 'Por confirmar'
}

// Busca, entre las respuestas reales que el lead dio en su reserva original, la que
// corresponde a esta pregunta del event type (por clave mapeada o por texto normalizado).
// Si no hay coincidencia (pregunta nueva que no existía antes), cae al placeholder.
function resolveAnswerFor(
  q: { name: string; type: string; answer_choices?: string[] },
  invitee: { name: string; phone?: string | null },
  priorAnswers?: Array<{ q: string; a: string }>
): string {
  if (priorAnswers && priorAnswers.length > 0) {
    const targetKey = mapKey(q.name)
    const targetSlug = slugify(q.name)
    for (const prior of priorAnswers) {
      const priorKey = mapKey(prior.q)
      if (targetKey && priorKey && targetKey === priorKey) return prior.a
      if (slugify(prior.q) === targetSlug) return prior.a
    }
  }
  return defaultAnswerFor(q, invitee)
}

export type CreateInviteeResult = {
  inviteeUri: string
  eventUri: string
  eventUuid: string | null
  rescheduleUrl: string | null
  cancelUrl: string | null
}

// Crea la reserva (invitee) en Calendly. Coloca el evento en el calendario del
// host y dispara el webhook invitee.created.
export async function createInvitee(params: {
  token: string
  eventType: CalendlyEventType
  startTimeISO: string
  invitee: { name: string; email: string; timezone?: string; phone?: string | null }
  utm?: {
    utm_term?: string | null
    utm_source?: string | null
    utm_campaign?: string | null
    utm_medium?: string | null
    utm_content?: string | null
  }
  // Respuestas reales del formulario que el lead ya dio (p.ej. al agendar por primera vez).
  // Se usan para responder las preguntas obligatorias al reagendar, en vez de inventar
  // placeholders que luego pisarían la cualificación real del lead.
  priorAnswers?: Array<{ q: string; a: string }>
}): Promise<CreateInviteeResult> {
  const { token, eventType, startTimeISO, invitee, utm, priorAnswers } = params
  const location = buildLocation(eventType, invitee)
  const body: Record<string, unknown> = {
    event_type: eventType.uri,
    start_time: startTimeISO,
    invitee: {
      name: invitee.name,
      email: invitee.email,
      timezone: invitee.timezone || 'Europe/Madrid',
    },
  }
  if (location) body.location = location
  // Calendly rechaza el objeto `tracking` si no vienen TODAS sus claves (devuelve
  // 400 "is missing" para utm_medium/utm_content/utm_term/salesforce_uuid). Por eso,
  // si queremos enviar alguna UTM, mandamos las 6 claves rellenando con "" las que no
  // tengamos. Si no hay ninguna UTM, omitimos `tracking` por completo (es opcional).
  if (utm && (utm.utm_term || utm.utm_source || utm.utm_campaign)) {
    body.tracking = {
      utm_source: utm.utm_source || 'app',
      utm_campaign: utm.utm_campaign || '',
      utm_medium: utm.utm_medium || '',
      utm_content: utm.utm_content || '',
      utm_term: utm.utm_term || '',
      salesforce_uuid: '',
    }
  }

  // El event type puede tener preguntas obligatorias (teléfono, selects, texto…).
  // Calendly rechaza la reserva ("Required Questions and Answers cannot be blank")
  // si no las respondemos. Contestamos automáticamente las obligatorias activas.
  const requiredQuestions = (eventType.custom_questions || []).filter((q) => q.enabled && q.required)
  if (requiredQuestions.length > 0) {
    body.questions_and_answers = requiredQuestions.map((q) => ({
      question: q.name,
      answer: resolveAnswerFor(q, invitee, priorAnswers),
      position: q.position,
    }))
  }
  const d = await cf<{ resource: { uri: string; event: string; reschedule_url?: string; cancel_url?: string } }>(
    token,
    '/invitees',
    { method: 'POST', body: JSON.stringify(body) }
  )
  const r = d.resource
  return {
    inviteeUri: r.uri,
    eventUri: r.event,
    eventUuid: typeof r.event === 'string' ? r.event.split('/').pop() || null : null,
    rescheduleUrl: r.reschedule_url || null,
    cancelUrl: r.cancel_url || null,
  }
}
