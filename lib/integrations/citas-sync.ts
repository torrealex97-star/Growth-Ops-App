import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { aplicarCustomFieldsGhl } from '@/lib/contacts/custom-fields-ghl'
import { mejorNombre } from '@/lib/contacts/resolve'
import { estadoAlSincronizar, mapearEstadoExterno } from '@/lib/appointments/status'
import { resolveUserIdByEmail } from '@/lib/tracking'

// Sincronización de CITAS (Calendly + GHL): la ÚNICA implementación, usada por
//   · el botón manual de Integraciones › history-sync (ventana completa),
//   · el cron diario /api/_/evergreen/cron/calendly-ghl (ventana incremental + presupuesto).
// Nació como código privado del botón; vivir duplicado es lo que hizo que la ingesta muriera en
// silencio: la importación inicial del 12-sep jamás tuvo pull programado y las agendas nuevas
// dejaron de entrar sin que nadie lo viera (ningún run de estos proveedores en sync-runs).
//
// Idempotencia: upsert lógico por (tenant_id, external_id) — re-ejecutar nunca duplica.
// Presupuesto: `deadlineMs` acota cada proveedor; si se corta, lo hecho está guardado y la
// siguiente ejecución continúa (los upserts son idempotentes).

type Json = Record<string, unknown>

export const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type CitasSyncOpts = {
  /** Solo eventos cuyo INICIO es >= this (ISO). Undefined = ventana completa (botón). */
  desdeInicio?: string
  /** Presupuesto de pared (Date.now()) por proveedor: al agotarse se devuelve el parcial. */
  deadlineMs?: number
  /**
   * 'completo' (botón): contactos primero, luego eventos — es lo que la API de GHL
   *   exige para no saltarse eventos de contactos nuevos.
   * 'soloEventos' (cron): salta la fase de contactos (paginarlos TODOS no cabe en el
   *   corte de 60 s de Vercel: dos pasadas en producción acabaron en 504 y un run
   *   colgado) y crea perezosamente, por fetch individual, SOLO el contacto de cada
   *   evento que aún no está en la BD.
   */
  modo?: 'completo' | 'soloEventos'
  /** Cache compartida field_key→id de custom_field_defs (rendimiento en pasadas grandes). */
  customDefsCache?: Map<string, Map<string, string>>
}

export async function findOrCreateContact(
  sb: SupabaseClient,
  tenantId: string,
  source: Json,
  opts: CitasSyncOpts = {}
) {
  const externalId = text(source.id) || text(source.contactId)
  const email = text(source.email)?.toLowerCase() || null
  const phone = text(source.phone)
  const firstName = text(source.firstName) || text(source.first_name)
  const lastName = text(source.lastName) || text(source.last_name)
  const fullName = text(source.name) || [firstName, lastName].filter(Boolean).join(' ') || 'Sin nombre'
  let row: { id: string; full_name: string | null; first_name: string | null; last_name: string | null } | null = null
  if (externalId) {
    const found = await sb
      .from('contacts')
      .select('id, full_name, first_name, last_name')
      .eq('tenant_id', tenantId)
      .eq('ghl_contact_id', externalId)
      .maybeSingle()
    row = found.data
  }
  if (!row && email) {
    const found = await sb
      .from('contacts')
      .select('id, full_name, first_name, last_name')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .maybeSingle()
    row = found.data
  }
  if (!row && phone) {
    const found = await sb
      .from('contacts')
      .select('id, full_name, first_name, last_name')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .maybeSingle()
    row = found.data
  }

  const values: Record<string, unknown> = {
    // La plataforma manda, salvo dos casos (ver mejorNombre): el hueco no pisa un nombre real y
    // la misma grafía en mejor mayúscula gana (los arreglos hechos en GHL se propagan).
    full_name: mejorNombre(row?.full_name, fullName) ?? fullName,
    first_name: mejorNombre(row?.first_name, firstName),
    last_name: mejorNombre(row?.last_name, lastName),
    email,
    phone,
    country: text(source.country),
    lead_channel: text(source.source),
    ...(externalId ? { ghl_contact_id: externalId } : {}),
    last_seen_at: text(source.dateUpdated) || new Date().toISOString(),
  }
  if (row) {
    // Custom fields de GHL (§ custom fields): merge idempotente sobre el jsonb del contacto.
    // Con cache de definiciones compartida entre llamadas de la misma pasada (opcional, vía opts).
    try {
      const { customFields } = await aplicarCustomFieldsGhl(sb, tenantId, row.id, source, opts?.customDefsCache)
      if (customFields) values.custom_fields = customFields
    } catch (e) {
      console.warn('[ghl] no se pudieron aplicar custom fields:', e instanceof Error ? e.message : e)
    }
    const { error } = await sb.from('contacts').update(values).eq('tenant_id', tenantId).eq('id', row.id)
    if (error) throw error
    return { id: row.id, created: false }
  }
  if (!email && !phone && !externalId) return null
  // Custom fields también en el alta (un contacto nuevo puede traerlos ya).
  let customFields: Record<string, string | number | boolean> | null = null
  try {
    const applied = await aplicarCustomFieldsGhl(sb, tenantId, 'pending', source, opts?.customDefsCache)
    // aplicarCustomFieldsGhl lee el contacto para el merge; para un insert nuevo basta el mapa
    // mapeado directo (no hay valores previos que pisar).
    const { mapearCustomFieldsGhl } = await import('@/lib/contacts/custom-fields-ghl')
    const mapeo = mapearCustomFieldsGhl(source)
    void applied
    if (mapeo.valores.size > 0) {
      const cache = opts?.customDefsCache ?? new Map()
      if (!cache.has('map')) cache.set('map', new Map())
      const keyToId = cache.get('map')!
      customFields = {}
      for (const [fieldKey, valor] of mapeo.valores) {
        let id = keyToId.get(fieldKey)
        if (!id) {
          const def = mapeo.definiciones.get(fieldKey)!
          const { data: existente } = await sb
            .from('custom_field_defs')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('field_key', fieldKey)
            .maybeSingle()
          if (existente?.id) {
            id = existente.id
          } else {
            const { data: creado, error: creadoErr } = await sb
              .from('custom_field_defs')
              .insert({ tenant_id: tenantId, field_key: fieldKey, label: def.label, field_type: def.field_type })
              .select('id')
              .single()
            if (creadoErr) console.warn(`[ghl] no se pudo crear el campo personalizado ${fieldKey}:`, creadoErr.message)
            id = creado?.id
          }
          if (id) keyToId.set(fieldKey, id)
        }
        if (id) customFields[id] = valor
      }
    }
  } catch (e) {
    console.warn('[ghl] no se pudieron aplicar custom fields al crear:', e instanceof Error ? e.message : e)
  }
  const { data, error } = await sb
    .from('contacts')
    .insert({
      tenant_id: tenantId,
      ...values,
      ...(customFields && Object.keys(customFields).length > 0 ? { custom_fields: customFields } : {}),
      first_seen_at: text(source.dateAdded) || new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  return { id: data.id as string, created: true }
}

/** Ventana temporal de la sync: completa (botón) o incremental ±solape (cron). */
export function ventana(opts: CitasSyncOpts) {
  const desde = opts.desdeInicio ? Date.parse(opts.desdeInicio) : Date.UTC(new Date().getUTCFullYear() - 5, 0, 1)
  const hasta = Date.UTC(new Date().getUTCFullYear() + 1, 11, 31, 23, 59, 59)
  return { desde, hasta }
}

/**
 * BACKFILL DEL DUEÑO POR CALENDARIO (closer-backfill): las citas de GHL ya importadas quedaron sin
 * closer y sin ghl_calendar_id — el pull no estampaba ni mapeaba. Tras el primer mapeo (la pasada
 * llena duenaDeCalendario), un UPDATE por (tenant, calendar, closer null) las re-deriva del
 * calendario: idempotente, sin borrados, nunca pisa asignaciones reales (filtra closer_id null).
 */
export async function backfillCloserGhl(
  sb: SupabaseClient,
  tenantId: string,
  mapa: Map<string, string | null>
): Promise<number> {
  let total = 0
  for (const [calendarId, closerId] of mapa) {
    if (!closerId) continue
    const result = await sb
      .from('appointments')
      .update({ closer_id: closerId })
      .eq('tenant_id', tenantId)
      .eq('ghl_calendar_id', calendarId)
      .is('closer_id', null)
    if (result.error) {
      console.warn(`[ghl] backfill closer del calendario ${calendarId.slice(0, 8)}:`, result.error.message)
      continue
    }
    total += result.count ?? 0
  }
  return total
}

/**
 * GHL también incluye assignedUserId dentro del evento persistido. Es la única pista que sobrevive
 * si el calendario se archiva y deja de aparecer en GET /calendars. Repara primero esa cola con un
 * GET por usuario GHL (memoizado), antes de gastar el presupuesto recorriendo calendarios activos.
 */
export async function backfillCloserGhlDesdePayload(
  sb: SupabaseClient,
  tenantId: string,
  locationId: string,
  headers: { Authorization: string; Version: string; Accept: string },
  opts: CitasSyncOpts = {}
): Promise<number> {
  const pendientes = await sb
    .from('appointments')
    .select('id, raw_payload')
    .eq('tenant_id', tenantId)
    .eq('external_source', 'ghl')
    .is('closer_id', null)
    .order('appointment_datetime', { ascending: false })
    .limit(100)
  if (pendientes.error) {
    console.warn('[ghl] backfill closer desde payload: no se pudo leer la cola:', pendientes.error.message)
    return 0
  }

  const localPorUsuarioGhl = new Map<string, string | null>()
  let total = 0
  for (const cita of pendientes.data ?? []) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break
    const row = cita as { id: string; raw_payload: Json | null }
    const assignedUserId = text(row.raw_payload?.assignedUserId) || text(row.raw_payload?.userId)
    if (!assignedUserId) continue
    if (!localPorUsuarioGhl.has(assignedUserId)) {
      try {
        const userResponse = await fetch(
          `https://services.leadconnectorhq.com/users/${encodeURIComponent(assignedUserId)}?locationId=${encodeURIComponent(locationId)}`,
          { headers, signal: AbortSignal.timeout(10_000) }
        )
        const userBody = (await userResponse.json().catch(() => ({}))) as Json
        const user = text(userBody.email) ? userBody : ((userBody.user as Json | undefined) ?? null)
        const localId = userResponse.ok && user ? await resolveUserIdByEmail(sb, text(user.email), tenantId) : null
        localPorUsuarioGhl.set(assignedUserId, localId)
      } catch (e) {
        console.warn('[ghl] no se pudo resolver assignedUserId del evento:', e instanceof Error ? e.message : e)
        localPorUsuarioGhl.set(assignedUserId, null)
      }
    }
    const closerId = localPorUsuarioGhl.get(assignedUserId) ?? null
    if (!closerId) continue
    const result = await sb
      .from('appointments')
      .update({ closer_id: closerId }, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('id', row.id)
      .is('closer_id', null)
    if (result.error) {
      console.warn('[ghl] backfill closer desde payload:', result.error.message)
      continue
    }
    total += result.count ?? 0
  }
  return total
}

/**
 * BACKFILL DEL DUEÑO DE CALENDLY (closer-backfill): las citas SIN closer no esperan a que el
 * bucle general (asc, con su corte por presupuesto) llegue a la cola — la cola NUEVA era
 * precisamente la que nunca entraba y dejaba ventas sin closer de referencia. Un GET del evento
 * (trae memberships, no hace falta invitees) por cada cita sin closer, dueño resuelto con la
 * MISMA memoria de emails y UPDATE filtrando closer_id null: idempotente, nunca reasigna.
 *
 * La fuente principal es raw_payload.event.event_memberships, que ya guardamos al importar. Leer
 * el dueño desde la propia fila no consume red y debe ejecutarse AUNQUE el presupuesto externo se
 * haya agotado. Solo las filas antiguas sin ese sobre requieren GET a Calendly y respetan el reloj.
 * Antes se comprobaba el deadline antes incluso de leer el payload: el bucle principal consumía
 * los 20 s y las 18 citas reparables quedaban eternamente como "Sin closer".
 */
export async function backfillCloserCalendly(
  sb: SupabaseClient,
  tenantId: string,
  headers: { Authorization: string; Accept: string },
  duenaPorEmail: Map<string, string | null>,
  opts: CitasSyncOpts = {}
): Promise<number> {
  let total = 0
  const pendientes = await sb
    .from('appointments')
    .select('id, external_id, raw_payload')
    .eq('tenant_id', tenantId)
    .eq('external_source', 'calendly')
    .is('closer_id', null)
    .order('appointment_datetime', { ascending: false })
    .limit(500)
  if (pendientes.error) {
    console.warn('[calendly] backfill closer: no se pudo leer la cola sin closer:', pendientes.error.message)
    return total
  }
  for (const cita of pendientes.data ?? []) {
    const row = cita as { id: string; external_id: string | null; raw_payload: Json | null }
    const storedEvent = row.raw_payload?.event as Json | undefined
    let ownerEmail = text((storedEvent?.event_memberships as Json[] | undefined)?.[0]?.user_email)
    if (!ownerEmail) {
      if (!row.external_id || (opts.deadlineMs && Date.now() > opts.deadlineMs)) continue
      const eventoResponse = await fetch(row.external_id, { headers, signal: AbortSignal.timeout(10_000) })
      const eventoBody = (await eventoResponse.json().catch(() => ({}))) as {
        resource?: { event_memberships?: Json[] }
      }
      if (!eventoResponse.ok) continue
      ownerEmail = text(eventoBody.resource?.event_memberships?.[0]?.user_email)
    }
    if (!ownerEmail) continue
    if (!duenaPorEmail.has(ownerEmail))
      duenaPorEmail.set(ownerEmail, await resolveUserIdByEmail(sb, ownerEmail, tenantId))
    const closerId = duenaPorEmail.get(ownerEmail) ?? null
    if (!closerId) continue
    const result = await sb
      .from('appointments')
      .update({ closer_id: closerId }, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('id', row.id)
      .is('closer_id', null)
    if (result.error) {
      console.warn('[calendly] backfill closer de una cita:', result.error.message)
      continue
    }
    total += result.count ?? 0
  }
  return total
}

export async function syncGhl(
  sb: SupabaseClient,
  tenantId: string,
  cfg: Record<string, string>,
  opts: CitasSyncOpts = {}
) {
  const token = cfg.GHL_API_TOKEN
  const locationId = cfg.GHL_LOCATION_ID
  if (!token || !locationId) throw new Error('Faltan GHL_API_TOKEN o GHL_LOCATION_ID')
  const headers = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
  const lazyContacts = opts.modo === 'soloEventos'
  // Cache ghl_contact_id → contacto local (o null si GHL no lo tiene): evita re-crear
  // contactos repetidos dentro de la misma pasada.
  const contactoCache = new Map<string, { id: string } | null>()
  // Cache compartida de definiciones de custom fields (1 query por campo nuevo, no por contacto).
  const customDefsCache = new Map<string, Map<string, string>>()
  let startAfterId = ''
  let startAfter = ''
  let pages = 0
  let imported = 0
  let updated = 0
  let appointmentsImported = 0
  let appointmentsUpdated = 0
  let closerBackfill = 0
  let cortado = false
  // Prioridad a las filas ya importadas: conservan assignedUserId aunque su calendario se haya
  // archivado. Se ejecuta antes de los listados externos para que el budget no las vuelva a dejar
  // permanentemente como "Sin closer".
  closerBackfill += await backfillCloserGhlDesdePayload(sb, tenantId, locationId, headers, opts)
  // En modo soloEventos esta fase NO corre: paginar todos los contactos no cabe en el cron.
  while (pages < 100 && !lazyContacts) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      cortado = true
      break
    }
    const url = new URL('https://services.leadconnectorhq.com/contacts/')
    url.searchParams.set('locationId', locationId)
    url.searchParams.set('limit', '100')
    if (startAfterId) url.searchParams.set('startAfterId', startAfterId)
    if (startAfter) url.searchParams.set('startAfter', startAfter)
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
    const body = (await response.json().catch(() => ({}))) as { contacts?: Json[]; meta?: Json; message?: string }
    if (!response.ok) throw new Error(body.message || `GHL respondió ${response.status}`)
    const contacts = body.contacts ?? []
    for (const contact of contacts) {
      const saved = await findOrCreateContact(sb, tenantId, contact, { customDefsCache })
      if (saved?.created) imported++
      else if (saved) updated++
    }
    pages++
    const last = contacts.at(-1)
    if (contacts.length < 100 || !last) break
    const nextId = text(last.id)
    const nextDate = Date.parse(text(last.dateAdded) || '')
    if (!nextId || !Number.isFinite(nextDate) || nextId === startAfterId) break
    startAfterId = nextId
    startAfter = String(nextDate)
  }

  const { desde, hasta } = ventana(opts)
  const calendarsResponse = await fetch(
    `https://services.leadconnectorhq.com/calendars/?locationId=${encodeURIComponent(locationId)}`,
    { headers, signal: AbortSignal.timeout(20_000) }
  )
  const calendarsBody = (await calendarsResponse.json().catch(() => ({}))) as {
    calendars?: Json[]
    message?: string
  }
  if (!calendarsResponse.ok)
    throw new Error(calendarsBody.message || `GHL calendarios respondió ${calendarsResponse.status}`)
  // CLOSER POR CALENDARIO. Para eventos actuales, el dueño canónico vive en el calendario. El
  // assignedUserId guardado en el evento es el fallback del histórico cuando ese calendario ya no
  // aparece. Se resuelve una vez por calendario y se cachea: assignedUserId → GET /users/{id} →
  // email → usuario de la app (acotado a la subcuenta).
  const duenaDeCalendario = new Map<string, string | null>()
  for (const calendar of calendarsBody.calendars ?? []) {
    // El reloj también aquí: cada dueño cuesta un GET /users (15 s de presupuesto propio) y
    // son varios por pasada. Sin corte, resolver 20 calendarios se come el budget SIN escribir
    // ni una cita (lección #277: el deadline gobierna TODAS las llamadas externas). Lo ya
    // resuelto queda en el mapa y la pasada sigue al bucle de eventos.
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      cortado = true
      break
    }
    const cid = text(calendar.id)
    const assignedUserId = text(calendar.assignedUserId) || text(calendar.userId)
    if (!cid || !assignedUserId) continue
    try {
      const userResponse = await fetch(
        `https://services.leadconnectorhq.com/users/${encodeURIComponent(assignedUserId)}?locationId=${encodeURIComponent(locationId)}`,
        { headers, signal: AbortSignal.timeout(15_000) }
      )
      const userBody = (await userResponse.json().catch(() => ({}))) as Json
      if (userResponse.ok) {
        // El endpoint ha devuelto el objeto directo o envuelto en `user` según versión: se toleran ambas.
        const user = (
          text((userBody as Json).email) ? (userBody as Json) : ((userBody.user as Json | undefined) ?? null)
        ) as Json | null
        const userId = user ? await resolveUserIdByEmail(sb, text(user.email), tenantId) : null
        if (userId) duenaDeCalendario.set(cid, userId)
      }
    } catch (e) {
      console.warn('[ghl] no se pudo resolver el dueño del calendario:', e instanceof Error ? e.message : e)
    }
  }
  for (const calendar of calendarsBody.calendars ?? []) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      cortado = true
      break
    }
    const calendarId = text(calendar.id)
    if (!calendarId) continue
    const url = new URL('https://services.leadconnectorhq.com/calendars/events')
    url.searchParams.set('locationId', locationId)
    url.searchParams.set('calendarId', calendarId)
    url.searchParams.set('startTime', String(desde))
    url.searchParams.set('endTime', String(hasta))
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
    const body = (await response.json().catch(() => ({}))) as { events?: Json[]; message?: string }
    if (!response.ok) throw new Error(body.message || `GHL agendas respondió ${response.status}`)
    for (const event of body.events ?? []) {
      // Reloj ANTES de cada evento (lección #277): el fetch perezoso del contacto cuesta hasta
      // 15 s, así que entre páginas ya es tarde. El corte abandona el evento SIN escribir —
      // el upsert es idempotente y la pasada siguiente lo relee y lo guarda.
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
        cortado = true
        break
      }
      if (event.deleted === true || text(event.type) === 'blockedSlot') continue
      const eventId = text(event.id)
      const ghlContactId = text(event.contactId)
      const startsAt = text(event.startTime)
      if (!eventId || !ghlContactId || !startsAt) continue
      // Contacto: las citas ya importadas conservan su contact_id (no se re-resuelve en cada
      // pasada diaria); solo las NUEVAS necesitan contacto, y en modo soloEventos se crea
      // perezosamente con un fetch individual — nunca paginando todos los contactos.
      const existing = await sb
        .from('appointments')
        .select('id, contact_id, closer_id, status')
        .eq('tenant_id', tenantId)
        .eq('external_id', eventId)
        .maybeSingle()
      let contact: { data: { id: string } | null } = {
        data: existing.data ? { id: (existing.data as { contact_id: string }).contact_id } : null,
      }
      if (!contact.data && contactoCache.has(ghlContactId)) {
        contact = { data: contactoCache.get(ghlContactId) ?? null }
      }
      if (!contact.data) {
        const found = await sb
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('ghl_contact_id', ghlContactId)
          .maybeSingle()
        contactoCache.set(ghlContactId, found.data)
        contact = { data: found.data }
      }
      if (!contact.data && lazyContacts) {
        const contactoResponse = await fetch(
          `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(ghlContactId)}`,
          { headers, signal: AbortSignal.timeout(15_000) }
        )
        const contactoBody = (await contactoResponse.json().catch(() => ({}))) as { contact?: Json }
        const creado =
          contactoResponse.ok && contactoBody.contact
            ? await findOrCreateContact(sb, tenantId, contactoBody.contact, { customDefsCache })
            : null
        contactoCache.set(ghlContactId, creado ? { id: creado.id } : null)
        contact = { data: creado ? { id: creado.id } : null }
      }
      if (!contact.data) continue
      // Misma traducción que el webhook (lib/appointments/status.ts). Un estado que no se reconoce
      // se queda en 'scheduled', que es lo que GHL da por defecto a una cita recién creada.
      const status = mapearEstadoExterno(text(event.appointmentStatus) || text(event.status)) || 'scheduled'
      const end = text(event.endTime)
      const duration = end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(startsAt)) / 60_000)) : null
      // Closer = dueño del calendario. SOLO se envía si hay usuario resuelto: al ser un update
      // de values, una pasada sin mapeo nunca pisa una asignación manual ni la del webhook.
      const closerId = duenaDeCalendario.get(calendarId) ?? null
      // RELLENA huecos, nunca reasigna: si la fila ya tenía closer (manual o del webhook), el
      // update no toca la columna — misma protección que el webhook de Calendly aplica en
      // reagenda ("el crm al reagendar cambia la propiedad del lead"): sin ella, la pasada
      // diaria del cron revertía cualquier corrección manual sobre citas de la ventana.
      const yaTeniaCloser = Boolean((existing.data as { closer_id?: string | null } | null)?.closer_id)
      const values = {
        tenant_id: tenantId,
        external_source: 'ghl',
        external_id: eventId,
        ghl_calendar_id: calendarId,
        contact_id: contact.data.id,
        appointment_datetime: new Date(startsAt).toISOString(),
        duration_minutes: duration,
        // Una pasada nunca retrocede una asistencia ya marcada a «sin resolver» (ver estadoAlSincronizar).
        status: estadoAlSincronizar((existing.data as { status?: string | null } | null)?.status, status),
        source: 'ghl',
        ...(closerId && !yaTeniaCloser ? { closer_id: closerId } : {}),
        calendar_name: text(calendar.name) || 'GoHighLevel',
        raw_payload: event,
      }
      if (existing.data) {
        const result = await sb.from('appointments').update(values).eq('tenant_id', tenantId).eq('id', existing.data.id)
        if (result.error) throw result.error
        appointmentsUpdated++
      } else {
        // tenant_id estampado en el insert: la fila nunca existe fuera de la subcuenta.
        const result = await sb.from('appointments').insert({ ...values, tenant_id: tenantId })
        if (result.error) throw result.error
        appointmentsImported++
      }
    }
  }
  // Backfill idempotente: citas ya importadas de estos calendarios sin closer heredan al dueño.
  if (duenaDeCalendario.size > 0) {
    closerBackfill += await backfillCloserGhl(sb, tenantId, duenaDeCalendario)
  }
  return {
    provider: 'ghl',
    pages,
    imported,
    updated,
    appointmentsImported,
    appointmentsUpdated,
    cortado,
    closerBackfill,
  }
}

// ── Calendly: scheduled_events + invitees ───────────────────────────────────
export async function syncCalendly(
  sb: SupabaseClient,
  tenantId: string,
  cfg: Record<string, string>,
  opts: CitasSyncOpts = {}
) {
  const token = cfg.CALENDLY_API_TOKEN
  if (!token) throw new Error('Falta CALENDLY_API_TOKEN')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const meResponse = await fetch('https://api.calendly.com/users/me', { headers, signal: AbortSignal.timeout(15_000) })
  const me = (await meResponse.json().catch(() => ({}))) as { resource?: { uri?: string }; message?: string }
  if (!meResponse.ok || !me.resource?.uri) throw new Error(me.message || 'Calendly no devolvió el usuario')

  // DUEÑO POR MEMBERSHIP, CON MEMORIA. Resolver el email del host eran 2 queries por EVENTO (dos
  // ilike con escape) — la mitad del coste de la pasada, repetido para el mismo host en cada
  // evento. El mapa por email resuelve una vez por host DISTINTO y los demás eventos reutilizan:
  // la semántica por evento no cambia (memberships[0] manda, igual que el webhook), solo deja de
  // repetirse. Es lo que permite que la pasada del cron recorra la ventana completa y llegue a
  // la cola NUEVA — las citas recientes sin closer eran precisamente las que el corte por
  // presupuesto dejaba atrás siempre (asc: re-procesaba la misma cabeza antigua, la cola no
  // entraba nunca y sus ventas quedaban sin closer de referencia).
  const duenaPorEmail = new Map<string, string | null>()

  const { desde, hasta } = ventana(opts)
  let pageToken = ''
  let pages = 0
  let imported = 0
  let updated = 0
  let cortado = false
  while (pages < 100) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      cortado = true
      break
    }
    const url = new URL('https://api.calendly.com/scheduled_events')
    url.searchParams.set('user', me.resource.uri)
    url.searchParams.set('count', '100')
    url.searchParams.set('sort', 'start_time:asc')
    // Ventana: el botón deja sin min/max (5 años atrás → +1 año); el cron acota por desde.
    url.searchParams.set('min_start_time', new Date(desde).toISOString())
    url.searchParams.set('max_start_time', new Date(hasta).toISOString())
    if (pageToken) url.searchParams.set('page_token', pageToken)
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
    const body = (await response.json().catch(() => ({}))) as {
      collection?: Json[]
      pagination?: { next_page_token?: string | null }
      message?: string
    }
    if (!response.ok) throw new Error(body.message || `Calendly respondió ${response.status}`)
    for (const event of body.collection ?? []) {
      // Reloj ANTES de cada evento (lección #277, cron 504 del 3-oct): el deadline solo
      // comprueba entre páginas y una página de TODOS los eventos de 14 días la mataba tras
      // 60 s de función. El corte deja el evento sin escribir; el run siguiente lo relee
      // (upserts idempotentes por external_id) y continúa donde quedó.
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
        cortado = true
        break
      }
      const uri = text(event.uri)
      if (!uri) continue
      // Reloj ANTES del fetch de invitees (gemelo del guard de antes del bucle): sin esto un
      // corte gastaba hasta 15 s en un evento que de todos modos no iba a procesarse.
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
        cortado = true
        break
      }
      const inviteesResponse = await fetch(`${uri}/invitees?count=100`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      const inviteesBody = (await inviteesResponse.json().catch(() => ({}))) as { collection?: Json[] }
      if (!inviteesResponse.ok) continue
      for (const invitee of inviteesBody.collection ?? []) {
        const contact = await findOrCreateContact(sb, tenantId, {
          name: invitee.name,
          email: invitee.email,
          phone: invitee.text_reminder_number,
          dateAdded: event.created_at,
        })
        if (!contact) continue
        // Closer = dueño del calendario (event_memberships[0].user_email), igual que el webhook:
        // resuelto por email o calendly_email y acotado a la subcuenta. SOLO se envía si hay
        // usuario resuelto: la pasada siguiente nunca pisa una asignación manual.
        const ownerEmail = text((event.event_memberships as Json[] | undefined)?.[0]?.user_email)
        let closerId: string | null = null
        if (ownerEmail) {
          if (!duenaPorEmail.has(ownerEmail))
            duenaPorEmail.set(ownerEmail, await resolveUserIdByEmail(sb, ownerEmail, tenantId))
          closerId = duenaPorEmail.get(ownerEmail) ?? null
        }
        const status = event.status === 'canceled' ? 'cancelled' : 'scheduled'
        const existing = await sb
          .from('appointments')
          .select('id, closer_id, status')
          .eq('tenant_id', tenantId)
          .eq('external_id', uri)
          .maybeSingle()
        // RELLENA huecos, nunca reasigna (misma protección que el webhook en reagenda y que la
        // vía GHL): un closer ya puesto —manual o del webhook— no se toca en el update.
        const yaTeniaCloser = Boolean((existing.data as { closer_id?: string | null } | null)?.closer_id)
        const values = {
          tenant_id: tenantId,
          external_source: 'calendly',
          external_id: uri,
          contact_id: contact.id,
          appointment_datetime: text(event.start_time) || new Date().toISOString(),
          // Calendly no sabe si el lead se presentó: nunca retrocede una asistencia ya marcada.
          status: estadoAlSincronizar((existing.data as { status?: string | null } | null)?.status, status),
          source: 'calendly',
          ...(closerId && !yaTeniaCloser ? { closer_id: closerId } : {}),
          calendar_name: text(event.name) || 'Calendly',
          meeting_url: text((event.location as Json | undefined)?.join_url),
          reschedule_url: text(invitee.reschedule_url),
          raw_payload: { event, invitee },
        }
        if (existing.data) {
          const result = await sb
            .from('appointments')
            .update(values)
            .eq('id', existing.data.id)
            .eq('tenant_id', tenantId)
          if (result.error) throw result.error
          updated++
        } else {
          const result = await sb.from('appointments').insert({ ...values, tenant_id: tenantId })
          if (result.error) throw result.error
          imported++
        }
      }
    }
    pages++
    pageToken = body.pagination?.next_page_token || ''
    if (!pageToken) break
  }
  // La cola SIN closer se repara AQUÍ, no esperando a que el bucle general (asc) la alcance:
  // cada pasada dedica su presupuesto restante a las citas recientes sin dueño (la venta nueva
  // del contacto sale con closer de referencia en cuanto su cita se repara).
  const closerBackfill = await backfillCloserCalendly(sb, tenantId, headers, duenaPorEmail, opts)
  return { provider: 'calendly', pages, imported, updated, cortado, closerBackfill }
}
