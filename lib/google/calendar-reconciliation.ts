import type { SupabaseClient } from '@supabase/supabase-js'
import { attendeeFingerprint } from '@/lib/google/calendar-sync'

export type ReconciliationStatus =
  | 'PENDING'
  | 'GOOGLE_ONLY'
  | 'MATCHED'
  | 'POSSIBLE_DUPLICATE'
  | 'TIME_MISMATCH'
  | 'CLOSER_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'CONTACT_MISSING'
  | 'IGNORED_PRIVATE'
  | 'SYNC_ERROR'

export type ExternalCalendarEvent = {
  id: string
  ownerUserId: string
  providerEventId: string
  startAt: string | null
  status: string
  visibility: string | null
  hasExternalAttendee: boolean
  attendeeFingerprints: string[]
}

export type CanonicalAppointment = {
  id: string
  contactId: string
  closerId: string | null
  externalId: string | null
  scheduledAt: string
  status: string
}

export type ContactIdentity = { id: string; email: string | null }

export type ReconciliationDecision = {
  appointmentId: string | null
  status: ReconciliationStatus
  method: 'provider_event_id' | 'contact_time_closer' | null
  reason: string
}

const MATCH_WINDOW_MS = 5 * 60 * 1000

function mismatchStatus(event: ExternalCalendarEvent, appointment: CanonicalAppointment): ReconciliationStatus {
  if (appointment.closerId && appointment.closerId !== event.ownerUserId) return 'CLOSER_MISMATCH'
  if (event.startAt && Math.abs(Date.parse(event.startAt) - Date.parse(appointment.scheduledAt)) > MATCH_WINDOW_MS) {
    return 'TIME_MISMATCH'
  }
  const eventCancelled = event.status === 'cancelled'
  const appointmentCancelled = appointment.status === 'cancelled'
  return eventCancelled !== appointmentCancelled ? 'STATUS_MISMATCH' : 'MATCHED'
}

/** Decide sin escribir. Cero o varios candidatos nunca se convierten en un match silencioso. */
export function matchGoogleCalendarEvent(options: {
  event: ExternalCalendarEvent
  appointments: CanonicalAppointment[]
  contacts: ContactIdentity[]
  fingerprintSecret: string
}): ReconciliationDecision {
  const exact = options.appointments.filter(
    (appointment) => appointment.externalId && appointment.externalId === options.event.providerEventId
  )
  if (exact.length > 1) {
    return { appointmentId: null, status: 'POSSIBLE_DUPLICATE', method: null, reason: 'multiple_provider_id_matches' }
  }
  if (exact.length === 1) {
    return {
      appointmentId: exact[0].id,
      status: mismatchStatus(options.event, exact[0]),
      method: 'provider_event_id',
      reason: 'provider_event_id',
    }
  }

  if (options.event.visibility === 'private' || !options.event.hasExternalAttendee) {
    return { appointmentId: null, status: 'IGNORED_PRIVATE', method: null, reason: 'no_external_identity' }
  }

  const contactIds = new Set(
    options.contacts
      .filter((contact) => {
        if (!contact.email) return false
        const fingerprint = attendeeFingerprint(contact.email, options.fingerprintSecret)
        return options.event.attendeeFingerprints.includes(fingerprint)
      })
      .map((contact) => contact.id)
  )
  if (contactIds.size === 0) {
    return { appointmentId: null, status: 'CONTACT_MISSING', method: null, reason: 'attendee_not_in_crm' }
  }

  const start = options.event.startAt ? Date.parse(options.event.startAt) : Number.NaN
  const candidates = options.appointments.filter(
    (appointment) =>
      contactIds.has(appointment.contactId) &&
      appointment.closerId === options.event.ownerUserId &&
      Number.isFinite(start) &&
      Math.abs(Date.parse(appointment.scheduledAt) - start) <= MATCH_WINDOW_MS
  )
  if (candidates.length > 1) {
    return { appointmentId: null, status: 'POSSIBLE_DUPLICATE', method: null, reason: 'multiple_contact_slot_matches' }
  }
  if (candidates.length === 0) {
    return { appointmentId: null, status: 'GOOGLE_ONLY', method: null, reason: 'no_appointment_in_slot' }
  }
  return {
    appointmentId: candidates[0].id,
    status: mismatchStatus(options.event, candidates[0]),
    method: 'contact_time_closer',
    reason: 'unique_contact_time_closer',
  }
}

export async function reconcileGoogleCalendarEvents(options: {
  sb: SupabaseClient
  tenantId: string
  userId: string
  fingerprintSecret: string
}): Promise<{ reviewed: number; matched: number; unresolved: number; failures: string[] }> {
  const eventsResult = await options.sb
    .from('google_calendar_events')
    .select(
      'id, owner_user_id, provider_event_id, event_start_at, status, visibility, has_external_attendee, attendee_fingerprints'
    )
    .eq('tenant_id', options.tenantId)
    .eq('owner_user_id', options.userId)
    .order('event_start_at', { ascending: false })
    .limit(1001)
  if (eventsResult.error) throw eventsResult.error
  if ((eventsResult.data?.length ?? 0) > 1000) {
    throw new Error('La conciliación supera el límite seguro de 1.000 eventos por ejecución.')
  }
  const events = eventsResult.data ?? []
  const dated = events.flatMap((event) => (event.event_start_at ? [Date.parse(event.event_start_at)] : []))
  if (dated.length === 0) return { reviewed: events.length, matched: 0, unresolved: events.length, failures: [] }

  const minDate = new Date(Math.min(...dated) - MATCH_WINDOW_MS).toISOString()
  const maxDate = new Date(Math.max(...dated) + MATCH_WINDOW_MS).toISOString()
  const appointmentsInRange = await options.sb
    .from('appointments')
    .select('id, contact_id, closer_id, external_id, appointment_datetime, status')
    .eq('tenant_id', options.tenantId)
    .gte('appointment_datetime', minDate)
    .lte('appointment_datetime', maxDate)
    .limit(2001)
  if (appointmentsInRange.error) throw appointmentsInRange.error
  if ((appointmentsInRange.data?.length ?? 0) > 2000) {
    throw new Error('La conciliación supera el límite seguro de 2.000 agendas por ejecución.')
  }
  const providerEventIds = [...new Set(events.map((event) => event.provider_event_id))]
  const exactAppointmentRows: NonNullable<typeof appointmentsInRange.data> = []
  for (let index = 0; index < providerEventIds.length; index += 100) {
    const appointmentsByExternalId = await options.sb
      .from('appointments')
      .select('id, contact_id, closer_id, external_id, appointment_datetime, status')
      .eq('tenant_id', options.tenantId)
      .in('external_id', providerEventIds.slice(index, index + 100))
      .limit(2000)
    if (appointmentsByExternalId.error) throw appointmentsByExternalId.error
    exactAppointmentRows.push(...(appointmentsByExternalId.data ?? []))
  }
  const appointmentRows = [...(appointmentsInRange.data ?? []), ...exactAppointmentRows]
  const uniqueAppointmentRows = [...new Map(appointmentRows.map((row) => [row.id, row])).values()]
  const appointments = uniqueAppointmentRows.map((appointment) => ({
    id: appointment.id,
    contactId: appointment.contact_id,
    closerId: appointment.closer_id,
    externalId: appointment.external_id,
    scheduledAt: appointment.appointment_datetime,
    status: appointment.status,
  }))

  const contacts: ContactIdentity[] = []
  const pageSize = 500
  for (let page = 0; page < 20; page += 1) {
    const contactsResult = await options.sb
      .from('contacts')
      .select('id, email')
      .eq('tenant_id', options.tenantId)
      .order('id')
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (contactsResult.error) throw contactsResult.error
    contacts.push(...(contactsResult.data ?? []).map((contact) => ({ id: contact.id, email: contact.email })))
    if ((contactsResult.data?.length ?? 0) < pageSize) break
    if (page === 19) throw new Error('La conciliación supera el límite seguro de 10.000 contactos.')
  }

  let matched = 0
  const decisions: Array<{
    id: string
    appointment_id: string | null
    reconciliation_status: ReconciliationStatus
    match_method: ReconciliationDecision['method']
    reconciliation_reason: string
  }> = []
  for (const event of events) {
    const decision = matchGoogleCalendarEvent({
      event: {
        id: event.id,
        ownerUserId: event.owner_user_id,
        providerEventId: event.provider_event_id,
        startAt: event.event_start_at,
        status: event.status,
        visibility: event.visibility,
        hasExternalAttendee: event.has_external_attendee,
        attendeeFingerprints: event.attendee_fingerprints ?? [],
      },
      appointments,
      contacts,
      fingerprintSecret: options.fingerprintSecret,
    })
    decisions.push({
      id: event.id,
      appointment_id: decision.appointmentId,
      reconciliation_status: decision.status,
      match_method: decision.method,
      reconciliation_reason: decision.reason,
    })
    if (decision.appointmentId && decision.status === 'MATCHED') matched += 1
  }
  const applied = await options.sb.rpc('apply_google_calendar_reconciliation', {
    p_tenant_id: options.tenantId,
    p_owner_user_id: options.userId,
    p_rows: decisions,
  })
  if (applied.error) throw applied.error
  const written = typeof applied.data === 'number' ? applied.data : Number(applied.data)
  const failures = written === decisions.length ? [] : [`batch_write_incomplete:${written}/${decisions.length}`]
  return { reviewed: events.length, matched, unresolved: events.length - matched, failures }
}
