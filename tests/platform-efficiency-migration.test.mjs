import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migration = await readFile(
  new URL('../supabase/migrations/20261006090000_optimize_rls_and_foreign_key_indexes.sql', import.meta.url),
  'utf8'
)

test('la optimización RLS conserva las policies y convierte auth helpers en InitPlans', () => {
  assert.match(migration, /from pg_policies/)
  assert.match(migration, /auth\[\.\]\(uid\|role\|jwt\)\[\(\]\[\)\]/)
  assert.match(migration, /alter policy %I on public\.\%I using/)
  assert.match(migration, /replace\(optimized_qual, 'auth\.uid\(\)', '\(select auth\.uid\(\)\)'\)/)
  assert.match(migration, /replace\(optimized_check, 'auth\.uid\(\)', '\(select auth\.uid\(\)\)'\)/)
  assert.doesNotMatch(migration, /drop policy/i)
  assert.doesNotMatch(migration, /create policy/i)
})

test('retira solo el índice duplicado y añade cobertura idempotente a FKs activas', () => {
  assert.match(migration, /drop index if exists public\.idx_cfa_campaign/)
  assert.doesNotMatch(migration, /drop index if exists public\.campaign_funnel_assignments_campaign_idx/)

  for (const index of [
    'appointments_offered_by_idx',
    'contact_attributions_collaborator_id_idx',
    'email_events_tenant_id_idx',
    'social_raw_payloads_tenant_id_idx',
    'reservation_refund_requests_sale_id_idx',
    'reservation_refund_requests_collection_id_idx',
    'reservation_refund_requests_refund_id_idx',
    'stripe_price_map_product_id_idx',
    'stripe_price_map_payment_plan_id_idx',
  ]) {
    assert.match(migration, new RegExp(`create index if not exists ${index}`))
  }
})
