import test from 'node:test'
import assert from 'node:assert/strict'
import { promedioPrimerPago } from '../../lib/finance/nuevo-vs-recurrente.ts'
const row = (id, sale_id, collected_at, gross_amount, status = 'collected') => ({
  id,
  sale_id,
  collected_at,
  gross_amount,
  status,
})
test('promedio inicial excluye cuotas posteriores y ventas antiguas', () => {
  const result = promedioPrimerPago(
    ['a', 'b'],
    [
      row('1', 'a', '2026-09-01', 100),
      row('2', 'a', '2026-09-02', 900),
      row('3', 'b', '2026-09-03', 200),
      row('4', 'old', '2026-09-03', 3000),
    ]
  )
  assert.deepEqual(result, { promedio: 150, ventasConPrimerPago: 2, ventasSinPrimerPago: 0 })
})
test('no inventa cero para ventas sin primer cobro ni pagos futuros', () => {
  assert.equal(promedioPrimerPago(['a', 'b'], [row('1', 'a', '2026-09-01', 100)]).promedio, null)
  assert.equal(promedioPrimerPago(['a'], [row('1', 'a', '2026-10-01', 100)], '2026-09-30').promedio, null)
  assert.equal(promedioPrimerPago([], []).promedio, null)
})
test('no elige arbitrariamente entre primeras transacciones ambiguas', () => {
  assert.equal(
    promedioPrimerPago(['a'], [row('2', 'a', '2026-09-01', 900), row('1', 'a', '2026-09-01', 100)]).promedio,
    null
  )
  assert.equal(promedioPrimerPago(['a'], [row('1', 'a', '2026-09-01', 100, 'pending')]).promedio, null)
})
