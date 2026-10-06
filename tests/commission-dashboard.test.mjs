import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTeamCommissionSummary, commissionSettlementSummary } from '../lib/commissions/dashboard.ts'

const row = (overrides = {}) => ({
  id: crypto.randomUUID(),
  tenant_id: 'tenant-a',
  sale_id: 'sale-a',
  collection_id: 'collection-a',
  refund_id: null,
  user_id: 'user-a',
  participant_type: 'closer',
  percent: 10,
  base_amount: 900,
  commission_amount: 90,
  direction: 'positive',
  status: 'pending',
  liquidation_month: '2026-10',
  approved_by: null,
  notes: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  users: { full_name: 'Closer A' },
  sales: { id: 'sale-a', gross_amount: 1000, sale_date: '2026-10-01' },
  collections: { id: 'collection-a', gross_amount: 500, collected_at: '2026-10-01T00:00:00Z' },
  ...overrides,
})

test('el rendimiento no duplica facturación ni cash por varias filas de la misma operación', () => {
  const summary = buildTeamCommissionSummary([row(), row({ id: 'commission-b', commission_amount: 20 })])[0]
  assert.equal(summary.booked, 1000)
  assert.equal(summary.collected, 500)
  assert.equal(summary.sales, 1)
  assert.equal(summary.collections, 1)
  assert.equal(summary.generated, 110)
})

test('las devoluciones reducen la comisión neta sin alterar la atribución única', () => {
  const summary = buildTeamCommissionSummary([
    row({ status: 'liquidated' }),
    row({ id: 'refund', direction: 'negative', commission_amount: 30, status: 'liquidated' }),
  ])[0]
  assert.equal(summary.generated, 60)
  assert.equal(summary.paid, 60)
})

test('la banda de liquidación separa aprobar, pagar, pagado y siguiente mes', () => {
  const summary = commissionSettlementSummary(
    [
      row({ commission_amount: 100, status: 'pending' }),
      row({ id: 'approved', commission_amount: 200, status: 'approved' }),
      row({ id: 'paid', commission_amount: 300, status: 'liquidated' }),
      row({ id: 'next', commission_amount: 400, status: 'approved', liquidation_month: '2026-11' }),
    ],
    new Date(2026, 9, 6)
  )
  assert.deepEqual(summary, {
    current: '2026-10',
    next: '2026-11',
    toApprove: 100,
    readyToPay: 200,
    paid: 300,
    nextCommitted: 400,
  })
})
