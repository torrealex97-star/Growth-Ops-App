import assert from 'node:assert/strict'
import test from 'node:test'
import { aMonedaBase, canonicalCash } from '../lib/canonical/cash.ts'
import { esMonedaBase, obtenerTasaAEur, parsearTasaFrankfurter } from '../lib/finance/fx.ts'

const pago = (id, amount, extra = {}) => ({
  payment_id: id,
  charge_id: null,
  amount,
  refunded_amount: 0,
  status: 'succeeded',
  paid_at: '2026-09-10T10:00:00Z',
  customer_email: null,
  currency: 'eur',
  ...extra,
})

test('un pago en USD con tipo se convierte a EUR con su tipo', () => {
  const r = canonicalCash([pago('a', 1000), pago('b', 300, { currency: 'usd', fx_rate_to_eur: '0.85' })], [])
  assert.equal(r.net, 1255)
  assert.deepEqual(r.noConvertidos, [])
})

test('un pago en USD SIN tipo no se cuenta como EUR y se reporta', () => {
  const r = canonicalCash([pago('a', 1000), pago('b', 300, { currency: 'usd', fx_rate_to_eur: null })], [])
  assert.equal(r.net, 1000)
  assert.deepEqual(r.noConvertidos, [{ moneda: 'usd', importe: 300, pagos: 1 }])
})

test('la devolución de un pago en otra moneda también se convierte', () => {
  const { rows } = aMonedaBase([pago('c', 100, { currency: 'usd', fx_rate_to_eur: 0.9, refunded_amount: 40 })])
  assert.equal(rows[0].amount, 90)
  assert.equal(rows[0].refunded_amount, 36)
})

test('filas sin moneda se tratan como base (compatibilidad)', () => {
  assert.equal(canonicalCash([{ ...pago('d', 50), currency: undefined }], []).net, 50)
  assert.equal(esMonedaBase(null), true)
  assert.equal(esMonedaBase('USD'), false)
})

test('parsearTasaFrankfurter exige tasa y fecha válidas', () => {
  assert.deepEqual(parsearTasaFrankfurter({ date: '2026-09-10', rates: { EUR: 0.85 } }), {
    rate: 0.85,
    date: '2026-09-10',
  })
  assert.equal(parsearTasaFrankfurter({ date: '2026-09-10', rates: {} }), null)
  assert.equal(parsearTasaFrankfurter({ date: 'x', rates: { EUR: 0.85 } }), null)
  assert.equal(parsearTasaFrankfurter(null), null)
})

test('obtenerTasaAEur no inventa un tipo si la API falla', async () => {
  assert.equal(await obtenerTasaAEur('usd', '2026-09-10', async () => ({ ok: false })), null)
  assert.equal(
    await obtenerTasaAEur('usd', '2026-09-10', async () => {
      throw new Error('red')
    }),
    null
  )
  assert.equal(
    await obtenerTasaAEur('eur', '2026-09-10', async () => {
      throw new Error('no debe llamarse')
    }),
    null
  )
  const ok = await obtenerTasaAEur('usd', '2026-09-10', async () => ({
    ok: true,
    json: async () => ({ date: '2026-09-09', rates: { EUR: 0.86 } }),
  }))
  assert.deepEqual(ok, { rate: 0.86, date: '2026-09-09' })
})
