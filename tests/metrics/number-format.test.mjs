import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCurrency, formatNumber } from '../../lib/utils.ts'

test('las cifras de cuatro dígitos siempre muestran el separador de miles', () => {
  assert.equal(formatNumber(1997), '1.997')
  assert.equal(formatNumber(5470), '5.470')
  assert.equal(formatNumber(15976), '15.976')
})

test('todos los importes usan miles con punto y decimales con coma', () => {
  assert.equal(formatCurrency(1997), '1.997,00 €')
  assert.equal(formatCurrency(5470.23), '5.470,23 €')
  assert.equal(formatCurrency(15976), '15.976,00 €')
})
