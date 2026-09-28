import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPeriodFunnel } from '../../lib/metrics/period-funnel.ts'
import { buildSalesOverview } from '../../lib/unit-economics.ts'
const range = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') }
const now = new Date('2026-10-01T00:00:00Z')
const contact = (id, date, email) => ({
  id,
  first_seen_at: date,
  created_at: '2026-09-10',
  email,
  phone: null,
  campaign_id: null,
})
const appointment = (id, date, status, extra = {}) => ({
  id,
  contact_id: id,
  appointment_datetime: date,
  status,
  ...extra,
})
const sale = (id, date, extra = {}) => ({
  id,
  sale_date: date,
  status: 'active',
  gross_amount: 100,
  contact_id: id,
  ...extra,
})

test('one period excludes historical leads, appointments and offers; duplicate import is not a new lead', () => {
  const result = buildPeriodFunnel(
    [
      contact('old', '2026-08-01', 'a@example.test'),
      contact('duplicate', '2026-09-02', 'a@example.test'),
      contact('new', '2026-09-03', 'b@example.test'),
    ],
    [
      appointment('old', '2026-08-02', 'show', { offered: true }),
      appointment('new', '2026-09-04', 'show'),
      appointment('pending', '2026-09-05', 'scheduled'),
      appointment('absent', '2026-09-06', 'no_show'),
    ],
    [
      sale('ok', '2026-09-05'),
      sale('reserve', '2026-09-07', { payment_plan_method: 'reserva' }),
      sale('old', '2026-08-05'),
    ],
    true,
    range,
    now
  )
  assert.equal(result.leads, 1)
  assert.equal(result.agendas, 3)
  assert.equal(result.asistencias, 1)
  assert.equal(result.offers, 1)
  assert.equal(result.offersDeclaradas, 0)
  assert.equal(result.cierres, 1)
  assert.equal(result.facturacion, 100)
})
test('empty period remains zero; unbounded history is explicit', () => {
  const rows = [appointment('a', '2026-08-01', 'show', { offered: true })]
  assert.equal(buildPeriodFunnel([], rows, [], true, range, now).offers, 0)
  assert.equal(buildPeriodFunnel([], rows, [], false, range, now).offers, 1)
})
test('past scheduled calls are not attendance; no-show is resolved; reserves are not sales', () => {
  const result = buildSalesOverview(
    [
      appointment('a', '2026-09-01', 'show'),
      appointment('b', '2026-09-01', 'no_show'),
      appointment('c', '2026-09-01', 'scheduled'),
      appointment('d', '2026-09-01', 'cancelled'),
    ],
    [sale('r', '2026-09-01', { payment_plan_method: 'reserva' })],
    [],
    'todos',
    now
  )
  assert.equal(result.shows, 1)
  assert.equal(result.tasaAsistencia, 50)
  assert.equal(result.ventas, 0)
})
