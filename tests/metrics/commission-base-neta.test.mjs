import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateCommissionsForCollection,
  calculateNegativeCommissionsForRefund,
} from '../../lib/commissions/calculator.ts'

// BASE NETA DE PASARELA (migración 20260919100000): la comisión de TODO el equipo
// (setter, closer, clásico y colaborador) se calcula sobre
// comisionable − fee de la pasarela que procesó el pago. El fee es el REAL de
// Stripe (API/espejo) o la referencia pública del plan en ventas manuales.
// Nunca negativa: un fee mayor que el comisionable acota la base a 0.

const TENANT = '11111111-1111-1111-1111-111111111111'

const collection = (over = {}) => ({
  id: 'col-1',
  sale_id: 'sale-1',
  collected_at: '2026-09-01T10:00:00Z',
  gross_amount: 1000,
  commissionable_amount: 1000,
  processing_fee: 0,
  ...over,
})

const sale = (over = {}) => ({
  id: 'sale-1',
  setter_id: 'user-setter',
  closer_id: 'user-closer',
  affiliate_id: null,
  affiliate_commission_percent: null,
  ...over,
})

test('sin fee de pasarela, la base es el comisionable íntegro (comportamiento previo)', () => {
  const rows = calculateCommissionsForCollection(TENANT, collection(), sale(), [])
  assert.equal(rows.length, 2)
  for (const r of rows) {
    assert.equal(r.base_amount, 1000)
    assert.equal(r.commission_amount, (r.percent * 1000) / 100)
  }
})

test('con fee real de Stripe, TODOS los lanes comisionan sobre comisionable − fee', () => {
  const rows = calculateCommissionsForCollection(TENANT, collection(), sale(), [], undefined, undefined, null, 29)
  const setter = rows.find((r) => r.participant_type === 'setter')
  const closer = rows.find((r) => r.participant_type === 'closer')
  assert.equal(setter.base_amount, 971)
  assert.equal(setter.commission_amount, (971 * 5) / 100)
  assert.equal(closer.base_amount, 971)
  assert.equal(closer.commission_amount, (971 * 10) / 100)
})

test('el colaborador (lane collaborator) usa la MISMA base neta que el resto del equipo', () => {
  const rows = calculateCommissionsForCollection(
    TENANT,
    collection({ commissionable_amount: 3000 }),
    sale({ setter_id: null, closer_id: 'user-admin', affiliate_id: 'user-colab', affiliate_commission_percent: 15 }),
    [],
    undefined,
    undefined,
    new Set(['user-colab']),
    90 // fee real de Stripe del cobro
  )
  const colab = rows.find((r) => r.participant_type === 'collaborator')
  const closer = rows.find((r) => r.participant_type === 'closer')
  assert.equal(colab, 'colab' && colab, 'la comisión del colaborador debe existir')
  assert.equal(colab.base_amount, 2910)
  assert.equal(colab.commission_amount, (2910 * 15) / 100)
  assert.equal(closer.base_amount, 2910, 'base idéntica para todos los lanes del cobro')
})

test('venta manual: el fee del plan (processing_fee del cobro) descuenta igual', () => {
  // El motor recibe el fee ya resuelto por generate.ts: espejo/API Stripe o el del plan.
  const rows = calculateCommissionsForCollection(TENANT, collection(), sale(), [], undefined, undefined, null, 50)
  for (const r of rows) assert.equal(r.base_amount, 950)
})

test('un fee mayor que el comisionable acota la base a 0, nunca negativa', () => {
  const rows = calculateCommissionsForCollection(TENANT, collection(), sale(), [], undefined, undefined, null, 2500)
  for (const r of rows) {
    assert.equal(r.base_amount, 0)
    assert.equal(r.commission_amount, 0)
  }
})

test('la negativa de una devolución TOTAL replica la base neta de la positiva', () => {
  const existing = [
    {
      id: 'com-1',
      tenant_id: TENANT,
      sale_id: 'sale-1',
      collection_id: 'col-1',
      user_id: 'user-closer',
      participant_type: 'closer',
      percent: 10,
      base_amount: 971, // positiva ya neta del fee de pasarela
      commission_amount: 97.1,
      direction: 'positive',
      status: 'pending',
    },
  ]
  const refund = { id: 'ref-1', sale_id: 'sale-1', commissionable_refund_amount: 1000 }
  const negativas = calculateNegativeCommissionsForRefund(refund, existing)
  assert.equal(negativas.length, 1)
  assert.equal(negativas[0].base_amount, 971)
  assert.equal(negativas[0].commission_amount, 97.1)
})

test('la negativa PARCIAL no devuelve más de lo comisionado (la pasarela no devuelve su fee)', () => {
  const existing = [
    {
      id: 'com-2',
      tenant_id: TENANT,
      sale_id: 'sale-1',
      collection_id: 'col-1',
      user_id: 'user-closer',
      participant_type: 'closer',
      percent: 10,
      base_amount: 971,
      commission_amount: 97.1,
      direction: 'positive',
      status: 'pending',
    },
  ]
  const refund = { id: 'ref-2', sale_id: 'sale-1', commissionable_refund_amount: 500 }
  const negativas = calculateNegativeCommissionsForRefund(refund, existing)
  assert.equal(negativas.length, 1)
  // Tope: la negativa nunca supera la base comisionada de la positiva.
  assert.equal(negativas[0].base_amount, 500)
  assert.equal(negativas[0].commission_amount, 50)
})
