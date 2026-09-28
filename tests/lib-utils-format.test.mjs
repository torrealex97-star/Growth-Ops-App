// Regresión: formatDateTime lanzaba RangeError ('Invalid time value') con una fecha malformada
// en vez de devolver '—' — a diferencia de formatCurrency/formatPercent, que sí tratan el valor
// ausente/no numérico como un guion pintable. Un solo valor sucio en la BD (import legado, campo
// de texto libre) tumbaba el render de cualquier panel que llamara a formatDateTime.
import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDateTime, formatCurrency, formatPercent } from '../lib/utils.ts'

test('formatDateTime: fecha inválida no lanza, devuelve el guion', () => {
  assert.equal(formatDateTime('no-es-una-fecha'), '—')
  assert.equal(formatDateTime('2026-13-45T99:99:99'), '—')
})

test('formatDateTime: ausente devuelve el guion', () => {
  assert.equal(formatDateTime(null), '—')
  assert.equal(formatDateTime(undefined), '—')
})

test('formatDateTime: fecha válida se formatea día/mes/año + hora:minuto', () => {
  const out = formatDateTime('2026-09-27T14:30:00Z')
  assert.match(out, /^\d{2}\/\d{2}\/2026, \d{2}:\d{2}$/)
})

test('formatCurrency/formatPercent: siguen tratando ausente como guion (no regresión)', () => {
  assert.equal(formatCurrency(null), '—')
  assert.equal(formatPercent(undefined), '—')
})
