import assert from 'node:assert/strict'
import test from 'node:test'
import { computeMonthlyPnl } from '../../lib/finance/pnl.ts'

// Dataset dorado: un mes con una venta activa, una parcialmente reembolsada
// (sigue contando como activa), una cancelada y una con chargeback (ambas
// deben quedar fuera de contractedRevenue). Fija el comportamiento de la
// Fase 5 (canonicalización sobre isActiveSale) para que una regresión futura
// rompa este test en vez de silenciarse en producción.
const sales = [
  { gross_amount: 1000, discount: 0, sale_date: '2026-03-05', status: 'active' },
  { gross_amount: 500, discount: 50, sale_date: '2026-03-10', status: 'partial_refund' },
  { gross_amount: 800, discount: 0, sale_date: '2026-03-15', status: 'cancelled' },
  { gross_amount: 300, discount: 0, sale_date: '2026-03-20', status: 'chargeback' },
  { gross_amount: 999, discount: 0, sale_date: '2026-02-28', status: 'active' }, // otro mes
]

const collections = [
  { id: 'c1', gross_amount: 1000, processing_fee: 30, collected_at: '2026-03-06', status: 'collected' },
  { id: 'c2', gross_amount: 450, processing_fee: 15, collected_at: '2026-03-11', status: 'collected' },
  { id: 'c3', gross_amount: 800, processing_fee: 20, collected_at: '2026-03-16', status: 'pending' }, // no cobrada aún
]

const refunds = [{ gross_refund_amount: 60, refund_date: '2026-03-18' }]

const expenses = [
  { amount: 100, category: 'cogs', expense_date: '2026-03-01' },
  { amount: 2000, category: 'sueldos', expense_date: '2026-03-01' },
  { amount: 300, category: 'publicidad', expense_date: '2026-03-01' },
  { amount: 50, category: 'herramientas', expense_date: '2026-03-01' },
  { amount: 20, category: 'otros', expense_date: '2026-03-01' },
]

const commissions = [
  { commission_amount: 100, direction: 'positive', collection_id: 'c1', liquidation_month: '2026-03' },
  { commission_amount: 10, direction: 'negative', collection_id: 'c1', liquidation_month: '2026-03' },
]

test('contractedRevenue solo suma ventas activas (isActiveSale) del mes', () => {
  const pnl = computeMonthlyPnl('2026-03', { sales, collections, refunds, expenses, commissions })
  // active (1000) + partial_refund (500) = 1500. cancelled y chargeback quedan fuera,
  // y la venta de febrero no pertenece a este mes.
  assert.equal(pnl.contractedRevenue, 1500)
})

test('grossRevenue solo suma collections cobradas (status collected) del mes', () => {
  const pnl = computeMonthlyPnl('2026-03', { sales, collections, refunds, expenses, commissions })
  // c1 (1000) + c2 (450) = 1450. c3 está pending, no cuenta.
  assert.equal(pnl.grossRevenue, 1450)
})

test('netRevenue resta refunds y discounts del mes una sola vez', () => {
  const pnl = computeMonthlyPnl('2026-03', { sales, collections, refunds, expenses, commissions })
  // grossRevenue 1450 - refunds 60 - discounts (0 + 50) = 1340
  assert.equal(pnl.totalDiscounts, 50)
  assert.equal(pnl.totalRefunds, 60)
  assert.equal(pnl.netRevenue, 1450 - 60 - 50)
})

test('preTaxProfit descuenta cogs y opex (comisiones, sueldos, adspend, software, fees, otros) del netRevenue', () => {
  const pnl = computeMonthlyPnl('2026-03', { sales, collections, refunds, expenses, commissions })
  const netRevenue = 1450 - 60 - 50
  const cogs = 100
  const comisiones = 100 - 10 // positiva - negativa
  const platformFees = 30 + 15 // c1 + c2 (c3 no está collected, no cuenta)
  const opex = comisiones + 2000 + 300 + 50 + platformFees + 20
  assert.equal(pnl.cogs, cogs)
  assert.equal(pnl.comisiones, comisiones)
  assert.equal(pnl.totalOpex, opex)
  assert.equal(pnl.preTaxProfit, netRevenue - cogs - opex)
})

test('un mes sin ventas ni cobros devuelve todo en cero y ratios en null (sin división por cero)', () => {
  const pnl = computeMonthlyPnl('2099-01', { sales, collections, refunds, expenses, commissions })
  assert.equal(pnl.contractedRevenue, 0)
  assert.equal(pnl.grossRevenue, 0)
  assert.equal(pnl.realizedCr, null)
  assert.equal(pnl.grossMargin, null)
  assert.equal(pnl.preTaxMargin, null)
  assert.equal(pnl.roi, null)
})
