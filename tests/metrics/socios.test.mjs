import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularRepartoSocios } from '../../lib/finance/socios.ts'

test('reparte el beneficio real proporcionalmente al % de cada socio', () => {
  const r = calcularRepartoSocios(10000, [
    { id: 'a', name: 'Socio A', profitPercent: 60 },
    { id: 'b', name: 'Socio B', profitPercent: 40 },
  ])
  assert.equal(r.preTaxProfit, 10000)
  assert.equal(r.totalPercent, 100)
  assert.deepEqual(
    r.socios.map((s) => s.amount),
    [6000, 4000]
  )
})

test('un periodo con pérdidas reparte importes negativos, no los oculta', () => {
  const r = calcularRepartoSocios(-2000, [{ id: 'a', name: 'Socio A', profitPercent: 50 }])
  assert.equal(r.socios[0].amount, -1000)
})

test('si los % activos no suman 100, no se inventa un reparto del resto', () => {
  const r = calcularRepartoSocios(1000, [{ id: 'a', name: 'Socio A', profitPercent: 30 }])
  assert.equal(r.totalPercent, 30)
  assert.equal(r.socios[0].amount, 300)
  // El 70% restante no aparece repartido a nadie: es información sobre la configuración, no un
  // cero que haya que rellenar.
  assert.equal(r.socios.length, 1)
})

test('sin socios activos, el reparto es una lista vacía, no un error', () => {
  const r = calcularRepartoSocios(5000, [])
  assert.equal(r.socios.length, 0)
  assert.equal(r.preTaxProfit, 5000)
})

test('redondea a 2 decimales sin arrastrar errores de coma flotante', () => {
  const r = calcularRepartoSocios(100, [
    { id: 'a', name: 'A', profitPercent: 33.33 },
    { id: 'b', name: 'B', profitPercent: 33.33 },
    { id: 'c', name: 'C', profitPercent: 33.34 },
  ])
  for (const s of r.socios) assert.equal(Number.isFinite(s.amount), true)
  assert.equal(r.socios[0].amount, 33.33)
})
