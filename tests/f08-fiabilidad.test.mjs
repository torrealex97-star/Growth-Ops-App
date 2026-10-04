import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depurarPorFiabilidad } from '../lib/metrics/fiabilidad.ts'

const m = (key, valor, muestra) => ({ key, nombre: key, nivel: 'ventas', valor, objetivo: 0.5, higherIsBetter: true, muestra })

test('con asistencia sin marcar, show/close rate son provisionales y el CAC no', () => {
  const r = depurarPorFiabilidad([m('show_rate', 0.1, 50), m('cac', 100, 50)], { fraccionResuelta: 0.01, pasadasSinMarcar: 300 })
  assert.deepEqual(r.provisionales.map((p) => p.key), ['show_rate'])
  assert.deepEqual(r.fiables.map((p) => p.key), ['cac'])
})
test('con el marcado al día se juzgan', () => {
  const r = depurarPorFiabilidad([m('show_rate', 0.1, 50)], { fraccionResuelta: 0.95, pasadasSinMarcar: 2 })
  assert.equal(r.provisionales.length, 0)
})
test('muestra bajo el mínimo es provisional; sin valor pasa tal cual', () => {
  const r = depurarPorFiabilidad([m('aov', 900, 2), m('ctr', null, null)], { fraccionResuelta: null, pasadasSinMarcar: 0 })
  assert.deepEqual(r.provisionales.map((p) => p.key), ['aov'])
  assert.deepEqual(r.fiables.map((p) => p.key), ['ctr'])
})
