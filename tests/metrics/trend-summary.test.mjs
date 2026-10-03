import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeTrend } from '../../lib/metrics/trend-summary.ts'

test('el total visible no se reduce a la segunda mitad ni inventa comparacion', () => {
  assert.deepEqual(summarizeTrend([1, 2, 3, 4, 5].map((value) => ({ value }))), {
    total: 15,
    previous: null,
    change: null,
  })
})
test('el periodo anterior es explicito, cero no produce porcentaje infinito', () => {
  assert.deepEqual(summarizeTrend([{ value: 20 }, { value: null }], 'sum', 10), {
    total: 20,
    previous: 10,
    change: 100,
  })
  assert.equal(summarizeTrend([{ value: 20 }], 'sum', 0).change, null)
  assert.equal(summarizeTrend([{ value: null }]).total, null)
  assert.equal(summarizeTrend([{ value: 0 }]).total, 0)
})
test('stocks usan el ultimo valor conocido', () => {
  assert.equal(summarizeTrend([{ value: 5 }, { value: 8 }, { value: null }], 'last').total, 8)
})
