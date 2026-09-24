import assert from 'node:assert/strict'
import test from 'node:test'
import { diaSiguiente, diasDelPeriodo, serieDiaria, acumular, avanceDelPeriodo } from '../../lib/metrics/series.ts'
import { serieFacturacionAcumulada, serieCashAcumulada } from '../../lib/metrics/series-negocio.ts'

const p = (desde, hasta) => ({ desde, hasta })

// =============================================================================================
// lib/metrics/series.ts — funciones puras de serie temporal
// =============================================================================================

test('diaSiguiente suma un día en UTC sin moverse de huso', () => {
  assert.equal(diaSiguiente('2026-01-31'), '2026-02-01')
  assert.equal(diaSiguiente('2026-02-01', 3), '2026-02-04')
})

test('diasDelPeriodo enumera todos los días del rango, en orden', () => {
  assert.deepEqual(diasDelPeriodo(p('2026-03-01', '2026-03-04')), [
    '2026-03-01',
    '2026-03-02',
    '2026-03-03',
    '2026-03-04',
  ])
})

test('diasDelPeriodo se acota para no generar una lista infinita con un periodo absurdo', () => {
  const dias = diasDelPeriodo(p('2020-01-01', '2030-01-01'), 10)
  assert.equal(dias.length, 10)
})

// LA REGLA QUE DECIDE ESTE MÓDULO: aquí sí, un día sin filas vale CERO (al revés que el resto del
// motor, donde sin dato nunca es cero). Sin esto la regresión leería los huecos como si el tiempo no
// hubiera pasado.
test('serieDiaria pone CERO en los días sin filas, no un hueco', () => {
  const serie = serieDiaria([{ fecha: '2026-03-01', valor: 100 }], p('2026-03-01', '2026-03-03'))
  assert.deepEqual(serie, [
    { fecha: '2026-03-01', valor: 100 },
    { fecha: '2026-03-02', valor: 0 },
    { fecha: '2026-03-03', valor: 0 },
  ])
})

test('serieDiaria suma varias filas del mismo día y descarta las de fuera de rango', () => {
  const serie = serieDiaria(
    [
      { fecha: '2026-03-01', valor: 100 },
      { fecha: '2026-03-01', valor: 50 },
      { fecha: '2026-02-28', valor: 999 }, // fuera de rango, no cuenta
      { fecha: null, valor: 999 }, // sin fecha, no cuenta
    ],
    p('2026-03-01', '2026-03-01')
  )
  assert.deepEqual(serie, [{ fecha: '2026-03-01', valor: 150 }])
})

test('acumular va sumando punto a punto', () => {
  const acumulado = acumular([
    { fecha: '2026-03-01', valor: 10 },
    { fecha: '2026-03-02', valor: 0 },
    { fecha: '2026-03-03', valor: 5 },
  ])
  assert.deepEqual(
    acumulado.map((x) => x.valor),
    [10, 10, 15]
  )
})

test('avanceDelPeriodo cuenta hoy como transcurrido completo, no a medias', () => {
  const a = avanceDelPeriodo(p('2026-03-01', '2026-03-10'), '2026-03-04')
  assert.equal(a.diasTotales, 10)
  assert.equal(a.diasTranscurridos, 4)
  assert.equal(a.diasRestantes, 6)
  assert.equal(a.fraccion, 0.4)
  assert.equal(a.cerrado, false)
})

test('avanceDelPeriodo marca cerrado cuando hoy ya pasó el final', () => {
  const a = avanceDelPeriodo(p('2026-03-01', '2026-03-10'), '2026-03-15')
  assert.equal(a.cerrado, true)
  assert.equal(a.fraccion, 1)
})

// =============================================================================================
// lib/metrics/series-negocio.ts — el mismo criterio de "qué venta/cobro cuenta" que agregados.ts
// =============================================================================================

test('serieFacturacionAcumulada solo cuenta ventas activas/completadas, acumuladas por día', () => {
  const serie = serieFacturacionAcumulada(
    [
      { sale_date: '2026-03-01', gross_amount: 1000, status: 'active' },
      { sale_date: '2026-03-02', gross_amount: 500, status: 'refunded' }, // no cuenta
      { sale_date: '2026-03-03', gross_amount: 2000, status: 'completada' },
    ],
    p('2026-03-01', '2026-03-03')
  )
  assert.deepEqual(
    serie.map((x) => x.valor),
    [1000, 1000, 3000]
  )
})

test('serieFacturacionAcumulada sin ventas devuelve la serie a cero, no vacía', () => {
  const serie = serieFacturacionAcumulada([], p('2026-03-01', '2026-03-02'))
  assert.deepEqual(
    serie.map((x) => x.valor),
    [0, 0]
  )
})

test('serieCashAcumulada excluye los cobros no confirmados', () => {
  const serie = serieCashAcumulada(
    [
      { collected_at: '2026-03-01T10:00:00Z', gross_amount: 300, is_confirmed: true },
      { collected_at: '2026-03-01T12:00:00Z', gross_amount: 700, is_confirmed: false },
    ],
    p('2026-03-01', '2026-03-01')
  )
  assert.deepEqual(
    serie.map((x) => x.valor),
    [300]
  )
})
