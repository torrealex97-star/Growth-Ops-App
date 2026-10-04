import assert from 'node:assert/strict'
import test from 'node:test'
import { cohorteDeLeads } from '../lib/funnels/cohorte.ts'

const rango = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') }
const ahora = new Date('2026-10-04T00:00:00Z')
const lead = (id, extra = {}) => ({
  id,
  email: `${id}@x.test`,
  phone: null,
  created_at: '2026-08-10T10:00:00Z',
  ...extra,
})

test('la cohorte sigue a las personas que entraron en el periodo, no a los hechos del periodo', () => {
  const contactos = [lead('a', { campaign_id: 'c1' }), lead('b'), lead('viejo', { created_at: '2026-05-01T00:00:00Z' })]
  const citas = [
    { contact_id: 'a', status: 'completed', appointment_datetime: '2026-09-02T10:00:00Z' }, // fuera del periodo, pero es de la cohorte
    { contact_id: 'b', status: 'cancelled', appointment_datetime: '2026-09-02T10:00:00Z' },
    { contact_id: 'viejo', status: 'completed', appointment_datetime: '2026-08-15T10:00:00Z' }, // no es de la cohorte
  ]
  const ventas = [
    { contact_id: 'a', status: 'active', gross_amount: 1000, sale_date: '2026-09-20' },
    { contact_id: 'viejo', status: 'active', gross_amount: 900, sale_date: '2026-08-20' },
  ]
  const c = cohorteDeLeads(contactos, citas, ventas, rango, ahora)
  assert.deepEqual(c, { leads: 2, conAgenda: 1, conAsistencia: 1, conVenta: 1, sinAtribuir: 1, enMaduracion: false })
})

test('una cohorte reciente está en maduración y una vacía no inventa nada', () => {
  const reciente = cohorteDeLeads([lead('z')], [], [], rango, new Date('2026-09-05T00:00:00Z'))
  assert.equal(reciente.enMaduracion, true)
  const vacia = cohorteDeLeads([], [], [], rango, ahora)
  assert.deepEqual(vacia, {
    leads: 0,
    conAgenda: 0,
    conAsistencia: 0,
    conVenta: 0,
    sinAtribuir: 0,
    enMaduracion: false,
  })
})

test('dos registros del mismo email son un solo lead de la cohorte', () => {
  const c = cohorteDeLeads(
    [lead('a'), lead('a2', { email: 'a@x.test' })],
    [{ contact_id: 'a2', status: 'completed', appointment_datetime: null }],
    [],
    rango,
    ahora
  )
  assert.equal(c.leads, 1)
  assert.equal(c.conAsistencia, 1)
})
