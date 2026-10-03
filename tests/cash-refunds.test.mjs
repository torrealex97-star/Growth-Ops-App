import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalCash, serieCanonicaCash } from '../lib/canonical/cash.ts'

// -----------------------------------------------------------------------------
// P1 PARCIAL (auditoría FASE A, 28-sep): el cash canónico debe comportarse igual
// que repNetCash tras el PR #269 — solo refunds 'processed' restan cash.
// pending/rejected no son dinero devuelto (§2: excluir estados no definitivos).
// El impacto es real solo cuando existan filas en esos estados, pero el
// invariante se fija aquí para que ninguna refactorización lo rompa.
// -----------------------------------------------------------------------------

const col = (id, amount, status = 'collected', ref = null, collected_at = '2026-09-10T10:00:00Z') => ({
  id,
  payment_reference: ref,
  gross_amount: amount,
  status,
  collected_at,
})
const refund = (collection_id, amount, status) => ({
  collection_id,
  refund_date: '2026-09-15T10:00:00Z',
  gross_refund_amount: amount,
  status,
})

// ── canonicalCash (total del periodo) ─────────────────────────────────────────

test('canonicalCash: solo el refund processed resta; pending y rejected no mueven cash', () => {
  const r = canonicalCash(
    [],
    [col('c1', 1000, 'collected', null)],
    [refund('c1', 300, 'processed'), refund('c1', 200, 'pending'), refund('c1', 100, 'rejected')]
  )
  assert.equal(r.net, 700, '1000 − 300: solo el processed es dinero realmente devuelto')
  assert.equal(r.refunds, 300)
})

test('canonicalCash: solo-pending/rejected deja el cash intacto', () => {
  const r = canonicalCash(
    [],
    [col('c1', 1000, 'collected', null)],
    [refund('c1', 400, 'pending'), refund('c1', 150, 'rejected')]
  )
  assert.equal(r.net, 1000)
  assert.equal(r.refunds, 0)
})

test('canonicalCash: un refund processed sobre cobro ya salido sigue sin restar dos veces', () => {
  const r = canonicalCash([], [col('c1', 500, 'reversed', null)], [refund('c1', 500, 'processed')])
  assert.equal(r.net, 0)
  assert.equal(r.refunds, 0)
})

// ── serieCanonicaCash (la serie debe respetar el MISMO invariante) ────────────

test('serieCanonicaCash: refunds pending/rejected no aparecen en la serie; el processed sí', () => {
  const serie = serieCanonicaCash(
    [],
    [col('c1', 1000, 'collected', null, '2026-09-10T10:00:00Z')],
    [refund('c1', 300, 'processed'), refund('c1', 100, 'pending'), refund('c1', 50, 'rejected')]
  )
  assert.deepEqual(serie, [
    { cubo: '2026-09-10', neto: 1000 },
    { cubo: '2026-09-15', neto: -300 },
  ])
})

test('serieCanonicaCash: con solo refunds no definitivos, la serie es la del cobro puro', () => {
  const serie = serieCanonicaCash(
    [],
    [col('c1', 1000, 'collected', null, '2026-09-10T10:00:00Z')],
    [refund('c1', 999, 'pending')]
  )
  assert.deepEqual(serie, [{ cubo: '2026-09-10', neto: 1000 }])
})
