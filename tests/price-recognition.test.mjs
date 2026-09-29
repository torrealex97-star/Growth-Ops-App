import test from 'node:test'
import assert from 'node:assert/strict'
import { firstInvoiceLinePriceId, resolveByPriceId } from '../lib/sales/priceRecognition.ts'

const map = [{ stripePriceId: 'price_abc', productId: 'prod_1', paymentPlanId: 'plan_1' }]

test('the Price ID comes from the first invoice line, never guessed from amount', () => {
  assert.equal(firstInvoiceLinePriceId(null), null)
  assert.equal(firstInvoiceLinePriceId({ lines: { data: [] } }), null)
  assert.equal(firstInvoiceLinePriceId({ lines: { data: [{ price: null }] } }), null)
  assert.equal(firstInvoiceLinePriceId({ lines: { data: [{ price: 'price_abc' }] } }), 'price_abc')
  assert.equal(firstInvoiceLinePriceId({ lines: { data: [{ price: { id: 'price_abc' } }] } }), 'price_abc')
})

test('a one-time Payment Link payment has no invoice and resolves no suggestion', () => {
  assert.equal(firstInvoiceLinePriceId(undefined), null)
  assert.equal(resolveByPriceId(null, map), null)
})

test('a mapped Price ID resolves the product/plan a human already chose once; an unmapped one never guesses', () => {
  assert.deepEqual(resolveByPriceId('price_abc', map), { productId: 'prod_1', paymentPlanId: 'plan_1' })
  assert.equal(resolveByPriceId('price_unmapped', map), null)
  assert.equal(resolveByPriceId('price_abc', []), null)
})
