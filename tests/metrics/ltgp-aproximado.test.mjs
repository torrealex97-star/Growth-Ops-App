import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularLtgpCacAproximado } from '../../lib/metrics/ltgp-aproximado.ts'

const base = { aov: 2000, cac: 500, costeEntregaCogsPeriodo: null, clientesPeriodo: null, costeManualEur: null }

// =============================================================================================
// FUENTE DEL COSTE: gastos 'cogs' reales SIEMPRE ganan al número manual, cuando existen.
// =============================================================================================

test('con gastos cogs reales y clientes en el periodo, se usa esa fuente (no el manual)', () => {
  const r = calcularLtgpCacAproximado({
    ...base,
    costeEntregaCogsPeriodo: 3000,
    clientesPeriodo: 10,
    costeManualEur: 999, // no debe usarse: hay dato real
  })
  assert.equal(r.fuenteCoste, 'cogs')
  assert.equal(r.costePorCliente, 300) // 3000 / 10
  // LTGP = 2000 - 300 = 1700; ratio = 1700 / 500 = 3.4
  assert.equal(r.valor, 3.4)
})

test('sin gastos cogs pero con coste manual, cae al fallback', () => {
  const r = calcularLtgpCacAproximado({ ...base, costeManualEur: 400 })
  assert.equal(r.fuenteCoste, 'manual')
  assert.equal(r.costePorCliente, 400)
  // LTGP = 2000 - 400 = 1600; ratio = 1600 / 500 = 3.2
  assert.equal(r.valor, 3.2)
})

test('gastos cogs a cero euros no cuenta como fuente real: cae al manual', () => {
  const r = calcularLtgpCacAproximado({ ...base, costeEntregaCogsPeriodo: 0, clientesPeriodo: 5, costeManualEur: 250 })
  assert.equal(r.fuenteCoste, 'manual')
  assert.equal(r.costePorCliente, 250)
})

test('gastos cogs sin ningún cliente en el periodo no divide por cero: cae al manual', () => {
  const r = calcularLtgpCacAproximado({
    ...base,
    costeEntregaCogsPeriodo: 3000,
    clientesPeriodo: 0,
    costeManualEur: 250,
  })
  assert.equal(r.fuenteCoste, 'manual')
  assert.equal(r.costePorCliente, 250)
})

// =============================================================================================
// SIN NINGUNA FUENTE DE COSTE: hueco declarado, nunca coste cero inventado.
// =============================================================================================

test('sin cogs y sin manual, es un hueco con motivo — nunca asume coste cero', () => {
  const r = calcularLtgpCacAproximado(base)
  assert.equal(r.valor, null)
  assert.equal(r.fuenteCoste, null)
  assert.equal(r.costePorCliente, null)
  assert.match(r.motivo, /Sin coste de entrega/)
})

// =============================================================================================
// EL RESTO DE LA CADENA: sin AOV o sin CAC tampoco se inventa un ratio.
// =============================================================================================

test('con coste pero sin ticket medio del periodo, hueco con motivo (no se confunde con coste 0)', () => {
  const r = calcularLtgpCacAproximado({ ...base, aov: null, costeManualEur: 300 })
  assert.equal(r.valor, null)
  assert.equal(r.costePorCliente, 300)
  assert.match(r.motivo, /ticket medio/)
})

test('con coste y aov pero sin CAC (sin gasto en ads), hueco con motivo', () => {
  const r = calcularLtgpCacAproximado({ ...base, cac: null, costeManualEur: 300 })
  assert.equal(r.valor, null)
  assert.match(r.motivo, /CAC/)
})

test('un CAC de cero no divide por cero: se declara hueco', () => {
  const r = calcularLtgpCacAproximado({ ...base, cac: 0, costeManualEur: 300 })
  assert.equal(r.valor, null)
  assert.match(r.motivo, /CAC/)
})
