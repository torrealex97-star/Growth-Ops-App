import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCollaboratorSaleReviews } from '../lib/commissions/dashboard.ts'

const row = (overrides = {}) => ({
  id: crypto.randomUUID(),
  sale_id: 'sale-1',
  collection_id: 'collection-1',
  user_id: 'user-1',
  participant_type: 'collaborator',
  percent: 20,
  base_amount: 100,
  commission_amount: 20,
  direction: 'positive',
  status: 'pending',
  created_at: '2026-10-01T00:00:00Z',
  sales: {
    id: 'sale-1',
    gross_amount: 200,
    sale_date: '2026-09-01',
    affiliate_commission_percent: 20,
    contacts: { full_name: 'Contacto de prueba' },
  },
  collections: { id: 'collection-1', gross_amount: 100, collected_at: '2026-10-01' },
  users: { full_name: 'Colaborador de prueba' },
  ...overrides,
})

test('agrupa una venta sin duplicar facturación ni el mismo cobro', () => {
  const result = buildCollaboratorSaleReviews([row(), row({ id: 'second', commission_amount: 5, base_amount: 25 })])
  assert.equal(result.length, 1)
  assert.equal(result[0].booked, 200)
  assert.equal(result[0].collected, 100)
  assert.equal(result[0].generated, 25)
})

test('separa pendiente, pagada y ajustes negativos y omite canceladas', () => {
  const result = buildCollaboratorSaleReviews([
    row({ status: 'liquidated', commission_amount: 20 }),
    row({ id: 'negative', collection_id: null, direction: 'negative', status: 'pending', commission_amount: 8 }),
    row({ id: 'cancelled', status: 'cancelled', commission_amount: 99 }),
  ])
  assert.equal(result[0].paid, 20)
  assert.equal(result[0].outstanding, -8)
  assert.equal(result[0].generated, 12)
  assert.equal(result[0].hasLiquidated, true)
})

test('el porcentaje cero conserva la atribución de la venta', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261006150000_adjust_sale_collaborator_commission.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /SET affiliate_id = p_user_id,\s+affiliate_commission_percent = p_target_percent/)
  assert.doesNotMatch(migration, /p_target_percent = 0 THEN NULL/)
})
