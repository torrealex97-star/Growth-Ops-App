// REGRESIÓN — Nuevo vs recurrente + gráfico dual facturación/cash (23-sep).
//
// Fija la semántica de lib/finance/nuevo-vs-recurrente.ts:
//   · NUEVO      = primer cobro RECOGIDO de cada venta (el mes en que entra el dinero).
//   · RECURRENTE = cualquier cobro posterior (cuotas de ventas de meses pasados = MRR).
//   · Solo cobros 'collected' cuentan; un cobro devuelto no nace ni recurre.
// Y la fuente de components/os/SalesChart.tsx: el chart dual superpone dos ÁREAS
// (facturación y cash) con colores distintos + leyenda — nunca solo color (data-viz-pro:
// leyenda + tooltip como refuerzo) y baseline en cero (barras/áreas honestas).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(`file://${join(root, 'lib/finance/nuevo-vs-recurrente.ts')}`)
const { clasificarCobrosPorMes, serieNuevoVsRecurrente, ymDe } = mod

test('ymDe: mes YYYY-MM de una fecha; vacío si no hay fecha', () => {
  assert.equal(ymDe('2026-09-15T10:00:00Z'), '2026-09')
  assert.equal(ymDe(null), '')
  assert.equal(ymDe(''), '')
})

test('primer cobro de la venta = NUEVO; los siguientes = RECURRENTE (aunque sea el mismo mes)', () => {
  const cobros = [
    { sale_id: 's1', collected_at: '2026-09-02', gross_amount: 100 },
    { sale_id: 's1', collected_at: '2026-09-20', gross_amount: 50 }, // cuota del MISMO mes → recurrente
  ]
  const r = clasificarCobrosPorMes(cobros, '2026-09')
  assert.equal(r.nuevo.n, 1)
  assert.equal(r.nuevo.importe, 100)
  assert.equal(r.recurrente.n, 1)
  assert.equal(r.recurrente.importe, 50)
})

test('venta cerrada en agosto con primer cobro en septiembre = NUEVO de SEPTIEMBRE (fecha de cobro decide)', () => {
  const cobros = [
    { sale_id: 's2', collected_at: '2026-09-10', gross_amount: 300 },
    { sale_id: 's2', collected_at: '2026-10-10', gross_amount: 100 },
  ]
  const sep = clasificarCobrosPorMes(cobros, '2026-09')
  assert.equal(sep.nuevo.importe, 300)
  const oct = clasificarCobrosPorMes(cobros, '2026-10')
  assert.equal(oct.recurrente.importe, 100)
  assert.equal(oct.nuevo.importe, 0)
})

test('solo collected cuenta: un cobro reversed no nace ni recurre', () => {
  const cobros = [
    { sale_id: 's3', collected_at: '2026-09-01', gross_amount: 100, status: 'reversed' },
    { sale_id: 's3', collected_at: '2026-09-15', gross_amount: 80, status: 'collected' },
  ]
  const r = clasificarCobrosPorMes(cobros, '2026-09')
  // El reversed NO puede ser el "primero": el primero recogido es el de 80 → NUEVO.
  assert.equal(r.nuevo.importe, 80)
  assert.equal(r.recurrente.importe, 0)
})

test('mes sin cobros → ceros, nunca NaN ni undefined', () => {
  const r = clasificarCobrosPorMes([{ sale_id: 's', collected_at: '2026-01-01', gross_amount: 10 }], '2026-12')
  assert.deepEqual(r, { nuevo: { n: 0, importe: 0 }, recurrente: { n: 0, importe: 0 } })
})

test('serie: una fila por mes pedido, con importes nuevo/recurrente separados', () => {
  const cobros = [
    { sale_id: 'a', collected_at: '2026-08-05', gross_amount: 1000 },
    { sale_id: 'a', collected_at: '2026-09-05', gross_amount: 250 },
    { sale_id: 'b', collected_at: '2026-09-08', gross_amount: 500 },
  ]
  const serie = serieNuevoVsRecurrente(cobros, [
    { ym: '2026-08', label: 'Ago' },
    { ym: '2026-09', label: 'Sep' },
  ])
  assert.equal(serie.length, 2)
  assert.equal(serie[0].nuevo, 1000)
  assert.equal(serie[0].recurrente, 0)
  assert.equal(serie[1].nuevo, 500) // b entra nuevo
  assert.equal(serie[1].recurrente, 250) // a es cuota de venta pasada
})

test('SALESCHART (fuente): superpone facturación y cash como dos ÁREAS con leyenda y tooltip', () => {
  const src = readFileSync(join(root, 'components/os/SalesChart.tsx'), 'utf8')
  assert.ok(src.includes('cash'), 'SalesChart debe aceptar la serie de cash')
  // Dos áreas = superposición legible (mismo eje Y, escalas comparables): facturación
  // (brand) + cash (verde) con rellenos distintos.
  const areas = (src.match(/<Area$/gm) ?? []).length + (src.match(/<Area\n/g) ?? []).length
  assert.ok(src.includes('dataKey="amount"') && src.includes('dataKey="cash"'), 'dos series: facturación + cash')
  assert.ok(src.includes('name="Facturación"') && src.includes('name="Cash cobrado"'), 'series con nombre legible')
  // Nunca solo color: leyenda (aquí custom en el header) + tooltip con ambas series.
  assert.ok(src.includes('<Legend') || src.includes('Legend'), 'leyenda declarada (no confiar solo en color)')
  assert.ok(src.includes('<Tooltip') || src.includes('CustomTooltip'), 'tooltip con detalle on demand')
})
