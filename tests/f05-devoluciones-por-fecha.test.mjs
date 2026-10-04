import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canonicalCash, serieCanonicaCash } from '../lib/canonical/cash.ts'
import { ultimaDevolucionPorPago } from '../lib/finance/refundDates.ts'

const pago = (id, amount, extra = {}) => ({
  payment_id: id,
  charge_id: `ch_${id}`,
  amount,
  refunded_amount: 0,
  status: 'succeeded',
  paid_at: '2026-07-10T10:00:00Z',
  customer_email: null,
  ...extra,
})

test('un reembolso de hoy sobre un cobro antiguo resta HOY, no en el mes del cobro', () => {
  const antiguo = pago('pi_1', 1000, {
    refunded_amount: 100,
    refunded_at: '2026-10-03T09:00:00Z',
    status: 'partially_refunded',
  })
  // Mes del cobro (julio): el cobro entra entero, la devolución no.
  const julio = canonicalCash([antiguo], [], [], [])
  assert.equal(julio.net, 1000)
  assert.equal(julio.refunds, 0)
  // Mes de la devolución (octubre): el cobro no está en el lote, pero la devolución resta.
  const octubre = canonicalCash([], [], [], [antiguo])
  assert.equal(octubre.net, -100)
  assert.equal(octubre.refunds, 100)
})

test('devolución sin fecha: se queda en el mes del cobro y se declara', () => {
  const sinFecha = pago('pi_2', 500, { refunded_amount: 50, status: 'partially_refunded' })
  const r = canonicalCash([sinFecha], [], [], [])
  assert.equal(r.net, 450)
  assert.equal(r.devolucionesSinFecha, 50)
})

test('sin la lista de devoluciones fechadas se conserva el comportamiento anterior', () => {
  const p = pago('pi_3', 300, {
    refunded_amount: 30,
    refunded_at: '2026-10-01T00:00:00Z',
    status: 'partially_refunded',
  })
  assert.equal(canonicalCash([p], []).net, 270)
})

test('cobro y devolución en el mismo periodo cuentan la devolución una sola vez', () => {
  const p = pago('pi_4', 200, { refunded_amount: 200, refunded_at: '2026-07-20T00:00:00Z', status: 'refunded' })
  const r = canonicalCash([p], [], [], [p])
  assert.equal(r.net, 0)
  assert.equal(r.refunds, 200)
})

test('la serie diaria resta la devolución en su día', () => {
  const p = pago('pi_5', 100, {
    refunded_amount: 40,
    refunded_at: '2026-07-12T08:00:00Z',
    status: 'partially_refunded',
  })
  const serie = Object.fromEntries(serieCanonicaCash([p], [], [], 'dia', [p]).map((x) => [x.cubo, x.neto]))
  assert.equal(serie['2026-07-10'], 100)
  assert.equal(serie['2026-07-12'], -40)
})

test('ultimaDevolucionPorPago toma la última devolución exitosa de cada pago', () => {
  const m = ultimaDevolucionPorPago([
    { id: 're_1', payment_intent: 'pi_a', created: 1_700_000_000, status: 'succeeded' },
    { id: 're_2', payment_intent: 'pi_a', created: 1_700_100_000, status: 'succeeded' },
    { id: 're_3', payment_intent: 'pi_a', created: 1_800_000_000, status: 'failed' },
    { id: 're_4', payment_intent: null, created: 1_700_000_000, status: 'succeeded' },
  ])
  assert.equal(m.size, 1)
  assert.equal(m.get('pi_a'), new Date(1_700_100_000 * 1000).toISOString())
})

test('el sync no pisa refunded_at con null cuando no lo conoce', () => {
  const s = readFileSync(new URL('../lib/finance/stripePaymentsSync.ts', import.meta.url), 'utf8')
  // Los upserts se agrupan por el conjunto de columnas de cada fila: nunca mezclan filas con y sin la clave.
  assert.match(s, /Object\.keys\(f\)\.sort\(\)\.join/)
  assert.match(s, /if \(!refundsRes\.truncated\)/)
})
