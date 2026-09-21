import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
}

export async function findOrCreateContact(sb: SupabaseClient, tenantId: string, source: Json) {
  const externalId = text(source.id) || text(source.contactId)
  const email = text(source.email)?.toLowerCase() || null
  const phone = text(source.phone)
  const firstName = text(source.firstName) || text(source.first_name)
  const lastName = text(source.lastName) || text(source.last_name)
  const fullName = text(source.name) || [firstName, lastName].filter(Boolean).join(' ') || 'Sin nombre'

  let row: { id: string } | null = null
  if (externalId) {
    const found = await sb
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_contact_id', externalId)
      .maybeSingle()
    row = found.data
  }
  if (!row && email) {
    const found = await sb.from('contacts').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle()
    row = found.data
  }
  if (!row && phone) {
    const found = await sb.from('contacts').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle()
    row = found.data
  }

  const values = {
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    country: text(source.country),
    lead_channel: text(source.source),
    ...(externalId ? { ghl_contact_id: externalId } : {}),
    last_seen_at: text(source.dateUpdated) || new Date().toISOString(),
  }
  if (row) {
    const { error } = await sb.from('contacts').update(values).eq('tenant_id', tenantId).eq('id', row.id)
    if (error) throw error
    return { id: row.id, created: false }
  }
  if (!email && !phone && !externalId) return null
  const { data, error } = await sb
    .from('contacts')
    .insert({ tenant_id: tenantId, ...values, first_seen_at: text(source.dateAdded) || new Date().toISOString() })
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

// ── GHL: contactos + eventos de calendario ──────────────────────────────────
// Los contactos van primero (los eventos referencian contactId; sin contacto previo se saltan).
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
  let startAfterId = ''
  let startAfter = ''
  let pages = 0
  let imported = 0
  let updated = 0
  let appointmentsImported = 0
  let appointmentsUpdated = 0
  let cortado = false
  while (pages < 100) {
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
      const saved = await findOrCreateContact(sb, tenantId, contact)
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
      if (event.deleted === true || text(event.type) === 'blockedSlot') continue
      const eventId = text(event.id)
      const ghlContactId = text(event.contactId)
      const startsAt = text(event.startTime)
      if (!eventId || !ghlContactId || !startsAt) continue
      const contact = await sb
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('ghl_contact_id', ghlContactId)
        .maybeSingle()
      if (!contact.data) continue
      const rawStatus = (text(event.appointmentStatus) || text(event.status) || 'scheduled').toLowerCase()
      const status =
        rawStatus === 'showed' || rawStatus === 'completed'
          ? 'show'
          : rawStatus === 'noshow'
            ? 'no_show'
            : rawStatus === 'cancelled' || rawStatus === 'canceled'
              ? 'cancelled'
              : rawStatus === 'confirmed'
                ? 'confirmed'
                : 'scheduled'
      const end = text(event.endTime)
      const duration = end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(startsAt)) / 60_000)) : null
      const values = {
        tenant_id: tenantId,
        external_source: 'ghl',
        external_id: eventId,
        contact_id: contact.data.id,
        appointment_datetime: new Date(startsAt).toISOString(),
        duration_minutes: duration,
        status,
        source: 'ghl',
        calendar_name: text(calendar.name) || 'GoHighLevel',
        raw_payload: event,
      }
      const existing = await sb
        .from('appointments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('external_id', eventId)
        .maybeSingle()
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
  return { provider: 'ghl', pages, imported, updated, appointmentsImported, appointmentsUpdated, cortado }
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
      const uri = text(event.uri)
      if (!uri) continue
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
        const status = event.status === 'canceled' ? 'cancelled' : 'scheduled'
        const values = {
          tenant_id: tenantId,
          external_source: 'calendly',
          external_id: uri,
          contact_id: contact.id,
          appointment_datetime: text(event.start_time) || new Date().toISOString(),
          status,
          source: 'calendly',
          calendar_name: text(event.name) || 'Calendly',
          meeting_url: text((event.location as Json | undefined)?.join_url),
          reschedule_url: text(invitee.reschedule_url),
          raw_payload: { event, invitee },
        }
        const existing = await sb
          .from('appointments')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('external_id', uri)
          .maybeSingle()
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
  return { provider: 'calendly', pages, imported, updated, cortado }
}
