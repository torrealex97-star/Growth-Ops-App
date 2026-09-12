import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 300

type Json = Record<string, unknown>

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireAdmin(tenant: string) {
  const t = await requireTenant(tenant)
  if ('error' in t) return t
  if (!['admin', 'director'].includes(t.role || '')) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return t
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

async function findOrCreateContact(sb: SupabaseClient, tenantId: string, source: Json) {
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

async function syncGhl(sb: SupabaseClient, tenantId: string, cfg: Record<string, string>) {
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
  while (pages < 100) {
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
  const startTime = Date.UTC(new Date().getUTCFullYear() - 5, 0, 1)
  const endTime = Date.UTC(new Date().getUTCFullYear() + 1, 11, 31, 23, 59, 59)
  for (const calendar of calendarsBody.calendars ?? []) {
    const calendarId = text(calendar.id)
    if (!calendarId) continue
    const url = new URL('https://services.leadconnectorhq.com/calendars/events')
    url.searchParams.set('locationId', locationId)
    url.searchParams.set('calendarId', calendarId)
    url.searchParams.set('startTime', String(startTime))
    url.searchParams.set('endTime', String(endTime))
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
        const result = await sb.from('appointments').insert(values)
        if (result.error) throw result.error
        appointmentsImported++
      }
    }
  }
  return { provider: 'ghl', pages, imported, updated, appointmentsImported, appointmentsUpdated }
}

async function syncCalendly(sb: SupabaseClient, tenantId: string, cfg: Record<string, string>) {
  const token = cfg.CALENDLY_API_TOKEN
  if (!token) throw new Error('Falta CALENDLY_API_TOKEN')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const meResponse = await fetch('https://api.calendly.com/users/me', { headers, signal: AbortSignal.timeout(15_000) })
  const me = (await meResponse.json().catch(() => ({}))) as { resource?: { uri?: string }; message?: string }
  if (!meResponse.ok || !me.resource?.uri) throw new Error(me.message || 'Calendly no devolvió el usuario')

  let pageToken = ''
  let pages = 0
  let imported = 0
  let updated = 0
  while (pages < 100) {
    const url = new URL('https://api.calendly.com/scheduled_events')
    url.searchParams.set('user', me.resource.uri)
    url.searchParams.set('count', '100')
    url.searchParams.set('sort', 'start_time:asc')
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
          const result = await sb.from('appointments').insert(values)
          if (result.error) throw result.error
          imported++
        }
      }
    }
    pages++
    pageToken = body.pagination?.next_page_token || ''
    if (!pageToken) break
  }
  return { provider: 'calendly', pages, imported, updated }
}

async function syncFathom(sb: SupabaseClient, tenantId: string, cfg: Record<string, string>) {
  const key = cfg.FATHOM_API_KEY
  if (!key) throw new Error('Falta FATHOM_API_KEY')
  let cursor = ''
  let pages = 0
  let matched = 0
  let unmatched = 0
  while (pages < 100) {
    const url = new URL('https://api.fathom.ai/external/v1/meetings')
    url.searchParams.set('limit', '100')
    url.searchParams.set('include_summary', 'true')
    url.searchParams.set('include_transcript', 'true')
    if (cursor) url.searchParams.set('cursor', cursor)
    const response = await fetch(url, {
      headers: { 'X-Api-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const body = (await response.json().catch(() => ({}))) as {
      items?: Json[]
      next_cursor?: string | null
      message?: string
    }
    if (!response.ok) throw new Error(body.message || `Fathom respondió ${response.status}`)
    for (const meeting of body.items ?? []) {
      // ID estable de la llamada (share_url/url son únicos por reunión en Fathom) — sin esto no
      // hay forma idempotente de saltar una llamada ya importada en un re-sync posterior.
      const fathomMeetingId = text(meeting.share_url) || text(meeting.url)
      if (fathomMeetingId) {
        const already = await sb
          .from('appointments')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('fathom_meeting_id', fathomMeetingId)
          .limit(1)
          .maybeSingle()
        if (already.data) {
          matched++ // ya importada en un sync anterior: no reprocesar, no es un fallo
          continue
        }
      }

      const invitees = Array.isArray(meeting.calendar_invitees) ? (meeting.calendar_invitees as Json[]) : []
      const external = invitees.find((i) => i.is_external === true) || invitees[0]
      const email = text(external?.email)?.toLowerCase()
      const startedAt = text(meeting.scheduled_start_time) || text(meeting.recording_start_time)
      if (!email || !startedAt) {
        unmatched++
        continue
      }
      const from = new Date(new Date(startedAt).getTime() - 12 * 60 * 60 * 1000).toISOString()
      const to = new Date(new Date(startedAt).getTime() + 12 * 60 * 60 * 1000).toISOString()
      const contact = await sb.from('contacts').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle()
      if (!contact.data) {
        unmatched++
        continue
      }
      // Todas las reuniones del contacto dentro de la ventana horaria — si hay más de una
      // candidata no se puede saber con certeza cuál fue la llamada real, así que se vincula
      // la transcripción a TODAS en vez de arriesgar una asociación incorrecta descartando una.
      const appointments = await sb
        .from('appointments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contact.data.id)
        .gte('appointment_datetime', from)
        .lte('appointment_datetime', to)
        .order('appointment_datetime', { ascending: false })
      if (!appointments.data || appointments.data.length === 0) {
        unmatched++
        continue
      }
      const summary = meeting.default_summary as Json | undefined
      const transcript = Array.isArray(meeting.transcript)
        ? (meeting.transcript as Json[])
            .map((line) => {
              const speaker = line.speaker as Json | undefined
              return `[${text(line.timestamp) || ''}] ${text(speaker?.display_name) || 'Speaker'}: ${text(line.text) || ''}`
            })
            .join('\n')
        : null
      const result = await sb
        .from('appointments')
        .update({
          recording_url: text(meeting.share_url) || text(meeting.url),
          ai_summary: text(summary?.markdown_formatted),
          transcript,
          transcript_status: transcript ? 'listo' : 'no_aplica',
          fathom_meeting_id: fathomMeetingId,
        })
        .eq('tenant_id', tenantId)
        .in(
          'id',
          appointments.data.map((a) => a.id as string)
        )
      if (result.error) throw result.error
      matched++
    }
    pages++
    cursor = body.next_cursor || ''
    if (!cursor) break
  }
  return { provider: 'fathom', pages, matched, unmatched }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireAdmin(tenant)
    if ('error' in auth) return auth.error
    const body = (await req.json().catch(() => ({}))) as { provider?: string }
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    const sb = serviceClient()
    if (body.provider === 'ghl') return NextResponse.json(await syncGhl(sb, auth.tenantId, cfg))
    if (body.provider === 'calendly') return NextResponse.json(await syncCalendly(sb, auth.tenantId, cfg))
    if (body.provider === 'fathom') return NextResponse.json(await syncFathom(sb, auth.tenantId, cfg))
    return NextResponse.json({ error: 'Proveedor no soportado' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
