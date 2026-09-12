import assert from 'node:assert/strict'
import test from 'node:test'
import { funnelBySource, aggregateFunnel } from '../../lib/analytics.ts'

// Dataset dorado: 4 leads, 2 pasan a agenda, 1 cierra venta. Verifica que aggregateFunnel colapsa
// funnelBySource (por fuente) en un único total, con los ratios correctos entre etapas.
const contactIds = ['c1', 'c2', 'c3', 'c4']
const attributions = [
  { contact_id: 'c1', source: 'meta', utm_source: null, utm_campaign: null, utm_content: null, is_primary: true },
  { contact_id: 'c2', source: 'meta', utm_source: null, utm_campaign: null, utm_content: null, is_primary: true },
  { contact_id: 'c3', source: 'organic', utm_source: null, utm_campaign: null, utm_content: null, is_primary: true },
]
const appointments = [
  { appointment_datetime: '2026-01-05', status: 'show', setter_id: null, closer_id: null, contact_id: 'c1' },
  { appointment_datetime: '2026-01-06', status: 'no_show', setter_id: null, closer_id: null, contact_id: 'c2' },
]
const sales = [
  {
    id: 's1',
    gross_amount: 1000,
    status: 'active',
    sale_date: '2026-01-07',
    closer_id: null,
    setter_id: null,
    contact_id: 'c1',
  },
  {
    id: 's2',
    gross_amount: 500,
    status: 'cancelled',
    sale_date: '2026-01-08',
    closer_id: null,
    setter_id: null,
    contact_id: 'c2',
  }, // no cuenta: no es venta activa
]

test('aggregateFunnel colapsa el desglose por fuente en un único total con ratios correctos', () => {
  const rows = funnelBySource(contactIds, attributions, sales, appointments)
  const totals = aggregateFunnel(rows)
  // 4 contactos totales (incluye c4 sin atribución -> "Directo/Sin atribuir")
  assert.equal(totals.leads, 4)
  assert.equal(totals.appointments, 2)
  assert.equal(totals.sales, 1) // s2 está cancelada, no cuenta
  assert.equal(totals.leadToAppt, 50) // 2/4
  assert.equal(totals.apptToSale, 50) // 1/2
  assert.equal(totals.leadToSale, 25) // 1/4
})

test('aggregateFunnel no divide por cero cuando no hay leads', () => {
  const totals = aggregateFunnel([])
  assert.deepEqual(totals, { leads: 0, appointments: 0, sales: 0, leadToAppt: 0, apptToSale: 0, leadToSale: 0 })
})
