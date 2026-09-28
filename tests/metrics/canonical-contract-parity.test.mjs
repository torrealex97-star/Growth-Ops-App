import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularAgregados } from '../../lib/metrics/agregados.ts'
import { serieFacturacionAcumulada } from '../../lib/metrics/series-negocio.ts'
import { cuentaComoVenta } from '../../lib/analytics.ts'
import { canonicalCash, serieCanonicaCash } from '../../lib/canonical/cash.ts'
import { getMetricDefinition } from '../../lib/ai/metrics/registry.ts'
import { SOURCE_REGISTRY } from '../../lib/sources/registry.ts'
const periodo = { desde: '2026-09-01', hasta: '2026-09-30' }
const base = { periodo, ventas: [], cobros: [], citas: [], campanas: [] }

test('METRICS §1/2 y MONEY D8: tarjeta, serie y analytics cuentan las mismas ventas', () => {
  const ventas = [
    {
      contact_id: 'c1',
      sale_date: '2026-09-01',
      gross_amount: 100,
      status: 'active',
      payment_plan_method: 'reserva',
      reservation_completed_at: null,
    },
    { contact_id: 'c2', sale_date: '2026-09-02', gross_amount: 200, status: 'partial_refund' },
    { contact_id: 'c3', sale_date: '2026-09-03', gross_amount: 300, status: 'cancelled' },
  ]
  const expected = ventas.filter(cuentaComoVenta).reduce((s, v) => s + v.gross_amount, 0)
  assert.equal(expected, 200)
  assert.equal(calcularAgregados({ ...base, ventas }).contracted_revenue.valor, expected)
  assert.equal(serieFacturacionAcumulada(ventas, periodo).at(-1).valor, expected)
})

test('METRICS §6: CAC cuenta contactos únicos, incluso cuando repiten compra', () => {
  const ventas = ['a', 'a', 'b'].map((contact_id) => ({
    contact_id,
    sale_date: '2026-09-02',
    status: 'active',
    gross_amount: 100,
  }))
  const campanas = [{ date: '2026-09-02', spend: 600 }]
  assert.equal(calcularAgregados({ ...base, ventas, campanas }).cac.valor, 300)
  assert.equal(
    calcularAgregados({ ...base, ventas: [...ventas, { ...ventas[0], contact_id: null }], campanas }).cac.valor,
    null
  )
})

test('SOURCE_OF_TRUTH: IA reutiliza literalmente el registro de fuentes', () => {
  for (const [alias, key] of [
    ['cash_collected', 'cash_collected'],
    ['revenue', 'revenue_closed'],
    ['booking', 'appointment'],
  ]) {
    assert.equal(getMetricDefinition(alias).formula, SOURCE_REGISTRY[key].formula)
    assert.equal(getMetricDefinition(alias).name, SOURCE_REGISTRY[key].label)
  }
})

test('SOURCE_OF_TRUTH: pagos pendientes no son caja ni desplazan un cobro confirmado', () => {
  const stripe = [
    {
      payment_id: 'p1',
      charge_id: null,
      amount: 999,
      refunded_amount: 0,
      status: 'pending',
      paid_at: '2026-09-02',
      customer_email: null,
    },
  ]
  const collections = [
    { id: 'c1', payment_reference: 'p1', gross_amount: 100, status: 'collected', collected_at: '2026-09-02' },
  ]
  assert.equal(canonicalCash(stripe, collections).net, 100)
  assert.equal(
    serieCanonicaCash(stripe, collections).reduce((s, p) => s + p.neto, 0),
    100
  )
})
