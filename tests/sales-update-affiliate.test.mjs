import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSaleUpdatePayload } from '../lib/sales/update-payload.ts'

const previous = { affiliate_id: 'affiliate-1' }

test('0 % conserva el colaborador atribuido y se guarda como cero, no como null', () => {
  const result = buildSaleUpdatePayload({ affiliate_commission_percent: 0 }, previous, 'admin-1')
  assert.deepEqual(result, {
    ok: true,
    payload: { updated_by: 'admin-1', affiliate_commission_percent: 0 },
  })
})

test('editar solo el porcentaje usa la atribución existente', () => {
  const result = buildSaleUpdatePayload({ affiliate_commission_percent: '12.5' }, previous, 'admin-1')
  assert.equal(result.ok, true)
  assert.equal(result.payload?.affiliate_commission_percent, 12.5)
  assert.equal('affiliate_id' in result.payload, false, 'un parche parcial no reescribe la atribución')
})

test('quitar explícitamente el colaborador limpia también su porcentaje', () => {
  const result = buildSaleUpdatePayload({ affiliate_id: 'none', affiliate_commission_percent: 20 }, previous, 'admin-1')
  assert.deepEqual(result, {
    ok: true,
    payload: { updated_by: 'admin-1', affiliate_id: null, affiliate_commission_percent: null },
  })
})

test('rechaza porcentajes fuera de 0–100', () => {
  const above = buildSaleUpdatePayload({ affiliate_commission_percent: 101 }, previous, 'admin-1')
  const invalid = buildSaleUpdatePayload({ affiliate_commission_percent: 'no-num' }, previous, 'admin-1')
  assert.equal(above.ok, false)
  assert.equal(invalid.ok, false)
  if (!above.ok) assert.match(above.error, /0 y 100/)
  if (!invalid.ok) assert.match(invalid.error, /0 y 100/)
})
