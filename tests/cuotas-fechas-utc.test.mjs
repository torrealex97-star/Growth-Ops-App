import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { addDaysUTC, addMonthsUTC, aFechaDia, parseFechaDia } from '../lib/sales/plan-cuotas.ts'
import { buildRestInstallments } from '../lib/commissions/calculator.ts'

// -----------------------------------------------------------------------------
// FECHAS SOLO-DÍA DEL PLAN DE CUOTAS (bughunt 28-sep): las fechas de cuotas,
// ventas y vencimientos son FECHAS DE CALENDARIO y estaban ancladas a medianoche
// LOCAL con new Date(año, mes, día) / new Date('YYYY-MM-DD'). Con toISOString()
// la medianoche local retrocede un día en cualquier huso al este de UTC (el
// "1º del mes siguiente" se guardaba como el último día del mes actual) y
// setMonth desborda el día 29-31 (30 ene + 1 mes = 2 mar). El helper canónico
// (lib/sales/plan-cuotas.ts) ancla en UTC y recorta al último día del mes
// destino; este test congela ese contrato.
// -----------------------------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(aqui, '..', p), 'utf8')

test('parseFechaDia + aFechaDia: ida y vuelta estable sea cual sea el huso del proceso', () => {
  assert.equal(aFechaDia(parseFechaDia('2026-09-01')), '2026-09-01')
  assert.equal(aFechaDia(parseFechaDia('2026-01-30T15:00:00Z')), '2026-01-30') // ignora la hora
  assert.equal(aFechaDia(new Date(Date.UTC(2026, 11, 31))), '2026-12-31')
})

test('addMonthsUTC: el día 29-31 se recorta al último día del mes destino, NUNCA desborda', () => {
  assert.equal(addMonthsUTC('2026-01-30', 1), '2026-02-28') // 2026 no es bisiesto (antes: 2 mar)
  assert.equal(addMonthsUTC('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsUTC('2024-01-31', 1), '2024-02-29') // bisiesto
  assert.equal(addMonthsUTC('2026-03-31', 1), '2026-04-30')
  assert.equal(addMonthsUTC('2026-08-31', 1), '2026-09-30')
  // Meses "normales" conservan el día, también a través de años:
  assert.equal(addMonthsUTC('2026-05-15', 12), '2027-05-15')
  assert.equal(addMonthsUTC('2026-02-01', 1), '2026-03-01')
  // Acepta Date anclado en UTC además de string:
  assert.equal(addMonthsUTC(parseFechaDia('2026-01-31'), 1), '2026-02-28')
})

test('addDaysUTC: días de calendario sin deriva horaria', () => {
  assert.equal(addDaysUTC('2026-01-30', 15), '2026-02-14')
  assert.equal(addDaysUTC('2026-09-01', 15), '2026-09-16') // refund_deadline de la venta
  assert.equal(addDaysUTC(parseFechaDia('2026-12-31'), 1), '2027-01-01')
})

test('buildRestInstallments: vencimientos mensuales con clamp y últimos céntimos cuadrados', () => {
  // Venta a 31 ene; primera cuota del resto a 31 ene → feb se recorta a 28, mar vuelve a 31.
  const filas = buildRestInstallments({
    saleId: 's1',
    totalGross: 1000,
    cashCollectionRatio: 1,
    alreadyPaid: 0,
    restCount: 3,
    startDate: '2026-01-31',
  })
  assert.deepEqual(
    filas.map((f) => f.due_date),
    ['2026-01-31', '2026-02-28', '2026-03-31']
  )
  const suma = filas.reduce((s, f) => s + f.expected_gross_amount, 0)
  assert.equal(Math.round(suma * 100) / 100, 1000)
  // Cuota índice 0 (reserva/entrada): su fecha es la de la venta, intacta.
  const conEntrada = buildRestInstallments({
    saleId: 's2',
    totalGross: 1200,
    cashCollectionRatio: 0.9,
    alreadyPaid: 200,
    restCount: 2,
    startDate: '2026-03-31',
  })
  assert.deepEqual(
    conEntrada.map((f) => f.due_date),
    ['2026-03-31', '2026-04-30']
  )
})

test('regresión de huso: la medianoche LOCAL es la que retrocede un día; el helper no', () => {
  // Reproduce el mecanismo del bug en un proceso con TZ=Asia/Tokyo:
  // new Date(2026, 8, 1) son las 00:00 CEST/JST del día 1 → toISOString da el 31-08.
  const viejoPatron = execFileSync(
    process.execPath,
    ['-e', 'const d = new Date(2026, 8, 1); console.log(d.toISOString().split("T")[0])'],
    { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' }
  ).trim()
  assert.equal(
    viejoPatron,
    '2026-08-31',
    'el patrón viejo (constructor local) sigue desfasando: el test documenta el mecanismo'
  )
  // El helper anclado en UTC es inmune al huso del proceso:
  const inmune = aFechaDia(new Date(Date.UTC(2026, 8, 1)))
  assert.equal(inmune, '2026-09-01')
})

// ── Guardas estáticas: el patrón peligroso no puede volver a colarse ──────────
// (mismo enfoque que taste-public-pages: invariantes sobre el fuente).

test('guarda: ni la página de venta ni calculator ni students usan setMonth local', () => {
  const nueva = read('app/[tenant]/ventas/registro/nueva/page.tsx')
  const calculator = read('lib/commissions/calculator.ts')
  const students = read('app/[tenant]/students/page.tsx')
  for (const [nombre, src] of [
    ['ventas/registro/nueva', nueva],
    ['lib/commissions/calculator', calculator],
    ['app/[tenant]/students', students],
  ]) {
    assert.ok(
      !/\.setMonth\(/.test(src),
      `${nombre} no debe sumar meses con setMonth local (overflow día 29-31); usar addMonthsUTC`
    )
  }
})

test('guarda: la página de venta ya no deriva días de toISOString sobre horas locales', () => {
  const nueva = read('app/[tenant]/ventas/registro/nueva/page.tsx')
  assert.ok(
    !nueva.includes(".toISOString().split('T')[0]"),
    'las fechas solo-día salen de aFechaDia/addMonthsUTC (ancladas en UTC), no de toISOString sobre medianoche local'
  )
  // Y los puntos concretos corregidos siguen presentes:
  assert.ok(
    nueva.includes('addMonthsUTC(saleDate, i - 1)'),
    'calendario SeQura: cuota i = venta + (i-1) meses con clamp'
  )
  assert.ok(nueva.includes('parseFechaDia(saleDate)'), 'la fecha de venta se ancla en UTC')
  assert.ok(
    nueva.includes('Date.UTC(hoy.getFullYear(), hoy.getMonth() + 1, 1)'),
    'el default de primera cuota es el 1º del mes siguiente real'
  )
})

test('guarda: calculator y students pasan por el helper canónico', () => {
  const calculator = read('lib/commissions/calculator.ts')
  assert.ok(calculator.includes('addMonthsUTC(startDate, i - 1)'), 'buildRestInstallments usa addMonthsUTC')
  assert.ok(calculator.includes('addMonthsUTC(saleDate, i - 1)'), 'calculateExpectedInstallments usa addMonthsUTC')
  const students = read('app/[tenant]/students/page.tsx')
  assert.ok(
    students.includes('addMonthsUTC(startDate, totalMonths)'),
    'el fin de programa usa addMonthsUTC (clamp incluido)'
  )
  assert.ok(students.includes('parseFechaDia(startStr)'), 'el inicio del programa se ancla en UTC')
})
