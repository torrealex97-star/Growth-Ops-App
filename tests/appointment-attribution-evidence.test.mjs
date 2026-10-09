import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migration = readFileSync(
  join(root, 'supabase/migrations/20261009170000_appointment_attribution_evidence.sql'),
  'utf8'
)

test('la agenda separa first, second, last y booking sin inventar second-touch', () => {
  for (const field of ['attribution_first', 'attribution_second', 'attribution_last', 'attribution_booking']) {
    assert.match(migration, new RegExp(`add column if not exists ${field} jsonb`))
  }
  assert.match(migration, /attribution_second.*NULL salvo/s)
  assert.match(migration, /secondAttributionSource/)
})

test('el backfill elimina IP y user-agent de los snapshots de GHL', () => {
  assert.match(migration, /- 'ip' - 'userAgent'/)
})

test('la cobertura distingue none, partial y complete', () => {
  assert.match(migration, /check \(attribution_status in \('none', 'partial', 'complete'\)\)/)
  assert.match(migration, /jsonb_path_exists/)
})
