import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// CLEANUP ADVISOR SUPABASE (10-oct).
//
// Dos hallazgos del advisor de seguridad cerrados por migración (y sus invariantes fijados):
//  1. `reservation_refund_requests` tenía RLS sin ninguna policy (lint 0008): la tabla de
//     reembolsos de reserva solo se escribe por service_role desde la ruta de refunds, y desde
//     ahora tiene SELECT por subcuenta con los mismos helpers que el resto del repo.
//  2. `career.raw_immutability_guard` tenía search_path mutable (lint 0011): la función de
//     trigger va ahora con `SET search_path = ''` para que ningún objeto dependa del
//     search_path de quien disparara el trigger.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('reservation_refund_requests: SELECT por subcuenta con helpers canónicos y sin grants de escritura', () => {
  const m = leer('supabase/migrations/20261010100000_advisor_cleanup.sql')
  assert.match(m, /CREATE POLICY reservation_refund_requests_admin_select ON public\.reservation_refund_requests/)
  // Misma forma que el resto de las policies del repo: InitPlan sobre los helpers de Auth.
  assert.match(m, /tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\) OR \(SELECT public\.is_super_admin\(\)\)/)
  assert.match(m, /FOR SELECT TO authenticated/)
  // Solo se concede SELECT: la ruta de refunds escribe con service_role, nunca desde el cliente.
  assert.match(m, /GRANT SELECT ON TABLE public\.reservation_refund_requests TO authenticated/)
  assert.doesNotMatch(m, /GRANT (INSERT|UPDATE|DELETE)/)
})

test('career.raw_immutability_guard: search_path fijado a vacío y semántica intacta', () => {
  const m = leer('supabase/migrations/20261010100000_advisor_cleanup.sql')
  assert.match(m, /CREATE OR REPLACE FUNCTION career\.raw_immutability_guard/)
  assert.match(m, /SET search_path = ''/)
  // Sigue siendo un trigger que bloquea UPDATE/DELETE sobre raw_items (semántica canónica).
  assert.match(m, /raw_items are immutable/)
  assert.match(m, /TG_OP = 'UPDATE' OR TG_OP = 'DELETE'/)
})
