import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { attendeeFingerprint } from '../lib/google/calendar-sync.ts'
import { mapGoogleCalendarEvent } from '../lib/google/calendar.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('normaliza recurrencia, cancelación, all-day y asistentes sin self/resource', () => {
  const mapped = mapGoogleCalendarEvent({
    id: 'event-1',
    iCalUID: 'uid@example.test',
    recurringEventId: 'series-1',
    originalStartTime: { dateTime: '2026-10-10T10:00:00+02:00', timeZone: 'Europe/Madrid' },
    start: { date: '2026-10-10' },
    end: { date: '2026-10-11' },
    status: 'cancelled',
    attendees: [
      { email: 'Closer@Example.test', self: true },
      { email: ' ROOM@example.test ', resource: true },
      { email: ' Lead@Example.test ' },
    ],
  })
  assert.deepEqual(mapped, {
    providerEventId: 'event-1',
    iCalUid: 'uid@example.test',
    recurringEventId: 'series-1',
    originalStartAt: '2026-10-10T10:00:00+02:00',
    startAt: '2026-10-10T00:00:00.000Z',
    endAt: '2026-10-11T00:00:00.000Z',
    timeZone: 'Europe/Madrid',
    status: 'cancelled',
    visibility: null,
    transparency: null,
    attendeeEmails: ['lead@example.test'],
    isAllDay: true,
    externalUpdatedAt: null,
  })
})

test('el fingerprint es estable, normalizado y no expone el email', () => {
  const first = attendeeFingerprint(' Lead@Example.test ', 'test-secret-not-production')
  const second = attendeeFingerprint('lead@example.test', 'test-secret-not-production')
  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(first, /lead|example/)
})

test('la ingesta es externa, idempotente y no escribe appointments', () => {
  const migration = read('supabase/migrations/20261008130000_google_calendar_event_ingestion.sql')
  const sync = read('lib/google/calendar-sync.ts')
  assert.match(migration, /UNIQUE \(tenant_id, connected_calendar_id, provider_event_id\)/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /owner_user_id = \(SELECT auth\.uid\(\)\)/)
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*FOR (?:INSERT|UPDATE|DELETE|ALL) TO authenticated/)
  assert.match(sync, /onConflict: 'tenant_id,connected_calendar_id,provider_event_id'/)
  assert.doesNotMatch(sync, /from\('appointments'\)/)
})

test('el cursor solo se confirma después de terminar los upserts y recupera el 410 con full sync', () => {
  const sync = read('lib/google/calendar-sync.ts')
  const upsert = sync.indexOf('.upsert(batch')
  const cursor = sync.indexOf('sync_token: page.nextSyncToken')
  assert.ok(upsert > 0 && cursor > upsert)
  assert.match(
    sync,
    /if \('error' in page && page\.invalidSyncToken\) \{[\s\S]*?page = await listGoogleCalendarEvents\(\{[\s\S]*?timeMin:[\s\S]*?timeMax:/
  )
})
