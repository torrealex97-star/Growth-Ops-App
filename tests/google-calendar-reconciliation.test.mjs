import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { attendeeFingerprint } from '../lib/google/calendar-sync.ts'
import { matchGoogleCalendarEvent } from '../lib/google/calendar-reconciliation.ts'

const secret = 'fixture-secret-not-production'
const baseEvent = {
  id: 'event-1',
  ownerUserId: 'closer-1',
  providerEventId: 'google-1',
  startAt: '2026-10-08T10:00:00.000Z',
  status: 'confirmed',
  visibility: 'default',
  hasExternalAttendee: true,
  attendeeFingerprints: [attendeeFingerprint('lead@example.test', secret)],
}
const appointment = {
  id: 'appointment-1',
  contactId: 'contact-1',
  closerId: 'closer-1',
  externalId: null,
  scheduledAt: '2026-10-08T10:02:00.000Z',
  status: 'confirmed',
}
const contacts = [{ id: 'contact-1', email: 'lead@example.test' }]

test('matches only a unique contact + time + closer candidate', () => {
  const decision = matchGoogleCalendarEvent({
    event: baseEvent,
    appointments: [appointment],
    contacts,
    fingerprintSecret: secret,
  })
  assert.deepEqual(decision, {
    appointmentId: 'appointment-1',
    status: 'MATCHED',
    method: 'contact_time_closer',
    reason: 'unique_contact_time_closer',
  })
})

test('does not guess when two appointments match the same evidence', () => {
  const decision = matchGoogleCalendarEvent({
    event: baseEvent,
    appointments: [appointment, { ...appointment, id: 'appointment-2' }],
    contacts,
    fingerprintSecret: secret,
  })
  assert.equal(decision.status, 'POSSIBLE_DUPLICATE')
  assert.equal(decision.appointmentId, null)
})

test('does not link an unknown attendee and does not expose the email', () => {
  const decision = matchGoogleCalendarEvent({
    event: baseEvent,
    appointments: [appointment],
    contacts: [],
    fingerprintSecret: secret,
  })
  assert.deepEqual(decision, {
    appointmentId: null,
    status: 'CONTACT_MISSING',
    method: null,
    reason: 'attendee_not_in_crm',
  })
})

test('exact provider id is strong but surfaces closer/time/status mismatches', () => {
  const exact = { ...appointment, externalId: 'google-1', closerId: 'closer-2' }
  const decision = matchGoogleCalendarEvent({
    event: baseEvent,
    appointments: [exact],
    contacts: [],
    fingerprintSecret: secret,
  })
  assert.equal(decision.appointmentId, exact.id)
  assert.equal(decision.method, 'provider_event_id')
  assert.equal(decision.status, 'CLOSER_MISMATCH')
})

test('a known contact without an appointment stays GOOGLE_ONLY', () => {
  const decision = matchGoogleCalendarEvent({ event: baseEvent, appointments: [], contacts, fingerprintSecret: secret })
  assert.equal(decision.status, 'GOOGLE_ONLY')
  assert.equal(decision.appointmentId, null)
})

test('a unique explicit id exposes a time mismatch instead of silently matching', () => {
  const exact = {
    ...appointment,
    externalId: 'google-1',
    scheduledAt: '2026-10-08T11:00:00.000Z',
  }
  const decision = matchGoogleCalendarEvent({
    event: baseEvent,
    appointments: [exact],
    contacts,
    fingerprintSecret: secret,
  })
  assert.equal(decision.status, 'TIME_MISMATCH')
  assert.equal(decision.appointmentId, exact.id)
})

test('private and internal-only events never create a commercial match', () => {
  const decision = matchGoogleCalendarEvent({
    event: { ...baseEvent, visibility: 'private', hasExternalAttendee: false },
    appointments: [],
    contacts,
    fingerprintSecret: secret,
  })
  assert.equal(decision.status, 'IGNORED_PRIVATE')
})

test('the database applies decisions in one service-only tenant-scoped batch', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261008143000_google_calendar_reconciliation.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /SECURITY INVOKER/)
  assert.match(migration, /event\.tenant_id = p_tenant_id/)
  assert.match(migration, /event\.owner_user_id = p_owner_user_id/)
  assert.match(migration, /REVOKE ALL .* FROM anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE .* TO service_role/)
})
