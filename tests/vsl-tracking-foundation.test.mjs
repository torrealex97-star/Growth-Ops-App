import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migration = readFileSync(join(root, 'supabase/migrations/20261009010000_vsl_tracking_foundation.sql'), 'utf8')
const accessMigration = readFileSync(join(root, 'supabase/migrations/20261009110000_vsl_tracking_access.sql'), 'utf8')
const indexMigration = readFileSync(
  join(root, 'supabase/migrations/20261009120000_vsl_tracking_fk_indexes.sql'),
  'utf8'
)

test('tracking VSL es aditivo y conserva vsl_sessions como compatibilidad', () => {
  assert.doesNotMatch(migration, /DROP TABLE[^;]*vsl_sessions/i)
  assert.match(migration, /FOREIGN KEY \(tenant_id, legacy_session_id\)/)
})

test('versiones y relaciones no pueden cruzar tenants', () => {
  assert.match(migration, /UNIQUE \(tenant_id, video_id, version_number\)/)
  assert.match(migration, /FOREIGN KEY \(tenant_id, video_id\)/)
  assert.match(migration, /FOREIGN KEY \(tenant_id, video_version_id\)/)
  assert.match(migration, /FOREIGN KEY \(tenant_id, playback_id\)/)
  assert.match(migration, /FOREIGN KEY \(tenant_id, contact_id\)/)
  assert.match(migration, /REFERENCES public\.vsl_sessions\(tenant_id, id\)/)
  assert.doesNotMatch(migration, /embed_location_id\)[\s\S]{0,100}ON DELETE SET NULL/)
})

test('eventos son idempotentes y distinguen los tipos canónicos', () => {
  assert.match(migration, /UNIQUE \(tenant_id, event_id\)/)
  for (const eventType of [
    'player_impression',
    'video_play',
    'video_seek',
    'video_progress',
    'video_complete',
    'video_cta_click',
    'video_viewer_identified',
  ]) {
    assert.match(migration, new RegExp(`'${eventType}'`))
  }
})

test('intervalos representan rangos vistos sin permitir huecos o duraciones negativas', () => {
  assert.match(migration, /end_second NUMERIC NOT NULL CHECK \(end_second > start_second\)/)
  assert.match(migration, /UNIQUE \(tenant_id, playback_id, batch_id, sequence_number\)/)
  assert.match(migration, /start_second, end_second/)
})

test('todas las tablas nuevas tienen RLS y solo lectura autenticada por tenant', () => {
  for (const table of [
    'vsl_video_versions',
    'vsl_embed_locations',
    'vsl_playback_sessions',
    'vsl_tracking_events',
    'vsl_watch_intervals',
    'vsl_viewer_identities',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`))
  }
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\)/)
  assert.match(migration, /SELECT public\.is_super_admin\(\)/)
  assert.doesNotMatch(migration, /FOR (INSERT|UPDATE|DELETE|ALL)/)
})

test('la capa de precisión no guarda IP completa ni geolocalización precisa', () => {
  assert.doesNotMatch(migration, /\bip_address\b/i)
  assert.doesNotMatch(migration, /\b(latitude|longitude|carrier|isp)\b/i)
})

test('la telemetría no admite escrituras directas de anon ni authenticated', () => {
  assert.match(accessMigration, /REVOKE ALL ON TABLE public\.%I FROM anon/)
  assert.match(accessMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/)
  assert.match(accessMigration, /GRANT SELECT ON TABLE public\.%I TO authenticated/)
  assert.match(accessMigration, /FOR SELECT TO authenticated/)
})

test('las relaciones VSL canónicas tienen índices de cobertura', () => {
  for (const columns of [
    'tenant_id, video_id',
    'tenant_id, embed_location_id',
    'tenant_id, legacy_session_id',
    'tenant_id, video_version_id',
  ]) {
    assert.match(indexMigration, new RegExp(`\\(${columns}\\)`))
  }
})
