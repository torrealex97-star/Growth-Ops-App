import assert from 'node:assert/strict'
import test from 'node:test'
import { leadDate } from '../../lib/analytics.ts'

// LA FECHA REAL DE UN LEAD, no la de la importación.
//
// La importación histórica de GHL estampó TODOS los contacts.created_at el mismo día (el de la
// importación): con ese campo, "Este mes" contaba los ~1000 leads del histórico como del mes.
// La fecha de negocio llega en first_seen_at (GHL dateAdded, guardada por history-sync) y el
// fallback es first_contact_at → created_at (filas nacidas en la app, donde created_at SÍ es
// fecha real: alta manual o webhook en vivo).

test('la fecha real del lead es first_seen_at cuando existe (lead importado de GHL)', () => {
  assert.equal(
    leadDate({
      first_seen_at: '2026-03-15T10:00:00Z',
      first_contact_at: '2026-03-16T10:00:00Z',
      created_at: '2026-09-10T10:00:00Z',
    }),
    '2026-03-15T10:00:00Z'
  )
})

test('sin first_seen_at, usa first_contact_at (lead antiguo pre-migración del campo)', () => {
  assert.equal(
    leadDate({ first_seen_at: null, first_contact_at: '2026-05-02T09:00:00Z', created_at: '2026-09-10T10:00:00Z' }),
    '2026-05-02T09:00:00Z'
  )
})

test('un lead nacido en la app (alta manual / webhook) usa created_at: ahí sí es fecha real', () => {
  assert.equal(
    leadDate({ first_seen_at: null, first_contact_at: null, created_at: '2026-09-18T12:00:00Z' }),
    '2026-09-18T12:00:00Z'
  )
})

test('nunca devuelve null/undefined: un lead sin fechas no desaparece de los totales', () => {
  assert.equal(leadDate({}), '')
  assert.equal(leadDate({ first_seen_at: null, first_contact_at: null, created_at: null }), '')
})
