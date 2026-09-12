import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChannelRows } from '../../lib/unit-economics.ts'

// Dataset dorado: un contacto con 2 ventas activas en el mismo canal debe contar
// como 1 cliente, no 2 — fija el fix de la Fase 5 (CAC/LTV se calculaban antes
// dividiendo por nº de filas de venta, no por clientes únicos).
const campaigns = [{ id: 'camp1', channel: 'meta', adspend: 1000, leads_generated: 50 }]
const contacts = [
  { id: 'contact1', campaign_id: 'camp1' },
  { id: 'contact2', campaign_id: 'camp1' },
  { id: 'contact3', campaign_id: null }, // sin campaña -> no atribuible a ningún canal
]
const sales = [
  { id: 's1', gross_amount: 500, status: 'active', contact_id: 'contact1' },
  { id: 's2', gross_amount: 300, status: 'partial_refund', contact_id: 'contact1' }, // mismo contacto, 2ª venta
  { id: 's3', gross_amount: 400, status: 'active', contact_id: 'contact2' },
  { id: 's4', gross_amount: 999, status: 'cancelled', contact_id: 'contact1' }, // no activa, fuera
  { id: 's5', gross_amount: 200, status: 'active', contact_id: 'contact3' }, // contacto sin canal, fuera de agg
]

test('customers cuenta contactos únicos, no filas de venta', () => {
  const rows = buildChannelRows(campaigns, sales, contacts)
  const meta = rows.find((r) => r.channel === 'meta')
  assert.ok(meta, 'debe existir la fila del canal meta')
  // contact1 (2 ventas activas) + contact2 (1 venta) = 2 clientes únicos, no 3 ventas.
  assert.equal(meta.customers, 2)
})

test('revenue suma todas las ventas activas del canal (no solo una por cliente)', () => {
  const rows = buildChannelRows(campaigns, sales, contacts)
  const meta = rows.find((r) => r.channel === 'meta')
  // 500 (s1) + 300 (s2) + 400 (s3) = 1200. s4 (cancelled) y s5 (sin canal) quedan fuera.
  assert.equal(meta.revenue, 1200)
})

test('cac = adspend del canal / clientes únicos del canal', () => {
  const rows = buildChannelRows(campaigns, sales, contacts)
  const meta = rows.find((r) => r.channel === 'meta')
  assert.equal(meta.cac, 1000 / 2)
})

test('un canal sin ventas activas devuelve cac null (sin división por cero)', () => {
  const rows = buildChannelRows([{ id: 'camp2', channel: 'google', adspend: 500, leads_generated: 10 }], [], [])
  const google = rows.find((r) => r.channel === 'google')
  assert.equal(google.customers, 0)
  assert.equal(google.cac, null)
})
