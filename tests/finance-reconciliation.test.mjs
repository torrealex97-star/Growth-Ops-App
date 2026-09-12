import assert from 'node:assert/strict'
import test from 'node:test'
import { amountsDiffer } from '../lib/finance/amounts.ts'

test('amountsDiffer accepts rounding differences up to five cents', () => {
  assert.equal(amountsDiffer(10, 10.05), false)
  assert.equal(amountsDiffer(10.05, 10), false)
})

test('amountsDiffer detects both under-recorded and over-recorded fees', () => {
  assert.equal(amountsDiffer(10, 10.06), true)
  assert.equal(amountsDiffer(10.06, 10), true)
})
