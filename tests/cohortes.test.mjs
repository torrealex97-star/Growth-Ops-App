// Regresión del fix de Cohortes de cobro: la columna "Clientes" debe contar contactos únicos
// (regla canónica docs/METRICS.md §6/§7), no filas de venta — el OUT_OF_SCOPE_FINDING que
// documentaba que un contacto con 2 ventas activas en la misma cohorte se contaba 2 veces.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCohorts } from '../lib/finance/cohortes.ts'

const sale = (o = {}) => ({
  id: 's',
  sale_date: '2026-08-15',
  gross_amount: 1000,
  status: 'active',
  contact_id: 'c1',
  ...o,
})
const coll = (o = {}) => ({
  sale_id: 's',
  gross_amount: 500,
  collected_at: '2026-08-20T10:00:00Z',
  status: 'collected',
  ...o,
})

test('un contacto con 2 ventas activas en la misma cohorte cuenta como 1 cliente', () => {
  const rows = buildCohorts([sale({ id: 's1' }), sale({ id: 's2' })], [coll({ sale_id: 's1' })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].clients, 1)
  assert.equal(rows[0].contracted, 2000)
})

test('contactos distintos son clientes distintos', () => {
  const rows = buildCohorts([sale({ contact_id: 'c1' }), sale({ contact_id: 'c2' })], [])
  assert.equal(rows[0].clients, 2)
})

test('una venta reembolsada no cuenta ni en contratado ni en clientes', () => {
  const rows = buildCohorts([sale({ status: 'refunded' })], [])
  assert.deepEqual(rows, [])
})

test('venta sin contact_id entra en contratado pero no en clientes', () => {
  const rows = buildCohorts([sale({ contact_id: null })], [])
  assert.equal(rows[0].clients, 0)
  assert.equal(rows[0].contracted, 1000)
})

test('el % cobrado a 30d se calcula sobre colecciones de la cohorte', () => {
  const rows = buildCohorts(
    [sale({ id: 's1' })],
    [
      coll({ sale_id: 's1', gross_amount: 400 }),
      coll({ sale_id: 's1', gross_amount: 100, collected_at: '2026-08-25T10:00:00Z' }),
    ]
  )
  assert.equal(rows[0].collectedAt[30], 500)
})

test('una reserva o venta anulada del mismo mes no aporta cobros a la cohorte activa', () => {
  const rows = buildCohorts(
    [sale(), sale({ id: 'cancelled', status: 'cancelled' }), sale({ id: 'reserve', payment_plan_method: 'reserva' })],
    [coll(), coll({ sale_id: 'cancelled' }), coll({ sale_id: 'reserve' })],
    new Date('2026-09-28T12:00:00Z')
  )
  assert.equal(rows[0].collectedAt[30], 500)
})

test('las ventanas maduran desde fin del mes y no incorporan cobros futuros', () => {
  const rows = buildCohorts(
    [sale()],
    [coll(), coll({ collected_at: '2026-10-01', gross_amount: 100 })],
    new Date('2026-09-30T12:00:00Z')
  )
  assert.deepEqual(rows[0].mature, { 30: true, 60: false, 90: false, 180: false })
  assert.equal(rows[0].collectedAt[180], 500)
})
