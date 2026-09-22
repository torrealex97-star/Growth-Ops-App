// Desglose mes a mes de comisiones futuras — lógica derivada de la ruta /commissions/future.
// El módulo importa el cliente de Supabase (no importable directo desde tests .mjs): se replica
// la lógica pura del bloque de previsión y se congela (patrón del repo).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = dirname(aqui)
const ruta = join(raiz, 'app/api/[tenant]/evergreen/commissions/future/route.ts')
const fuente = readFileSync(ruta, 'utf8')

// ── REPLICA CONGELADA del bloque de previsión derivada de la ruta ──
function prevision(venta, cobros, hoyISO) {
  const plan = venta.plan ?? null
  const n = plan?.method === 'reserva' ? 1 : Math.max(1, venta.installments_count ?? plan?.number_of_payments ?? 1)
  const bruto = Number(venta.gross_amount || 0)
  const per = Math.floor((bruto / n) * 100) / 100
  const importes = []
  let asignado = 0
  for (let i = 0; i < n; i++) {
    const importe = i === n - 1 ? Math.round((bruto - asignado) * 100) / 100 : per
    asignado += per
    importes.push(importe)
  }
  const fechaVenta = (venta.sale_date || '').split('T')[0]
  const inicioCuotas = venta.installments_start_date || fechaVenta
  const fechas = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      fechas.push(fechaVenta)
      continue
    }
    const d = new Date(inicioCuotas + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + (venta.installments_start_date ? i - 1 : i))
    fechas.push(d.toISOString().split('T')[0])
  }
  const restantes = [...importes]
  const ordenados = [...cobros].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
  for (const cobro of ordenados) {
    let resto = cobro.bruto
    for (let i = 0; i < restantes.length && resto > 0.005; i++) {
      const aplicado = Math.min(resto, restantes[i])
      restantes[i] -= aplicado
      resto -= aplicado
    }
  }
  const filas = []
  for (let i = 0; i < n; i++) {
    if (!(restantes[i] > 0.005)) continue
    filas.push({
      dueDate: fechas[i],
      base: Math.round(restantes[i] * 100) / 100,
      numero: i + 1,
      estado: fechas[i] < hoyISO ? 'overdue' : 'pending',
    })
  }
  return filas
}

// Agregación del front (dashboard/page.tsx): mes de dueDate, 'review' o mes pasado = cobrado.
function porMes(filas, sourceDe, ymActual) {
  const mapa = new Map()
  for (const f of filas) {
    const ym = (f.dueDate || '').slice(0, 7)
    if (!ym) continue
    const e = mapa.get(ym) ?? { cobrado: 0, porCobrar: 0 }
    if (sourceDe(f) === 'review' || ym < ymActual) e.cobrado += f.amount
    else e.porCobrar += f.amount
    mapa.set(ym, e)
  }
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
}

test('el endpoint de comisiones futuras deriva la previsión de ventas sin calendario', () => {
  // La ruta contiene el bloque de previsión derivada con el criterio canónico
  assert.ok(fuente.includes('PREVISIÓN DERIVADA'), 'la ruta anuncia la previsión derivada')
  assert.ok(fuente.includes('payment_plans'), 'consulta payment_plans para el método reserva')
  assert.ok(fuente.includes("'reserva'"), 'reserva = 1 cuota')
  assert.ok(fuente.includes('FIFO'), 'los cobros reales cubren cuotas en orden FIFO')
  assert.ok(fuente.includes("vencida ? 'overdue' : 'pending'"), 'las vencidas se marcan overdue, no se ocultan')
  assert.ok(fuente.includes("estado: 'pending' | 'overdue' | 'review'"), 'cada fila declara su estado')
  assert.ok(fuente.includes("'installment'"), 'las filas derivadas usan source installment')
})

test('previsión: 6 cuotas mensuales, cobros reales cubren las primeras (FIFO)', () => {
  const filas = prevision(
    {
      gross_amount: 6000,
      sale_date: '2026-07-10',
      installments_count: 6,
      plan: { number_of_payments: 6, method: 'financiado' },
    },
    [
      { bruto: 1000, fecha: '2026-07-10' },
      { bruto: 1000, fecha: '2026-08-10' },
      { bruto: 1000, fecha: '2026-09-10' },
    ],
    '2026-09-22'
  )
  // Cuotas 1-3 cubiertas por los cobros; quedan 4-6 (oct, nov, dic) por cobrar.
  assert.equal(filas.length, 3)
  assert.deepEqual(
    filas.map((f) => f.dueDate),
    ['2026-10-10', '2026-11-10', '2026-12-10']
  )
  for (const f of filas) {
    assert.equal(f.base, 1000)
    assert.equal(f.estado, 'pending')
  }
})

test('previsión: método reserva = 1 sola cuota, ya cobrada si hay cobro del total', () => {
  const filas = prevision(
    { gross_amount: 500, sale_date: '2026-08-01', plan: { method: 'reserva' } },
    [{ bruto: 500, fecha: '2026-08-01' }],
    '2026-09-22'
  )
  assert.equal(filas.length, 0, 'la reserva cubierta no genera futuro')
})

test('previsión: cuotas vencidas sin cobrar se marcan overdue (impago), no desaparecen', () => {
  const filas = prevision(
    { gross_amount: 3000, sale_date: '2026-07-01', installments_count: 3, plan: { number_of_payments: 3 } },
    [{ bruto: 1000, fecha: '2026-07-01' }], // cuota 2 (1-ago) venció y no se pagó
    '2026-09-22'
  )
  // Cuota 1 cobrada; cuotas 2 y 3 vencidas → estado overdue (para el KPI de impagos).
  assert.equal(filas.length, 2)
  for (const f of filas) assert.equal(f.estado, 'overdue')
})

test('agregación del front: mes actual separa ya-cobrado (review) de por-cobrar (installment)', () => {
  const filas = [
    { dueDate: '2026-09-05', amount: 300, source: 'review', estado: 'review' }, // cobrada, pendiente de revisión
    { dueDate: '2026-09-15', amount: 200, source: 'installment', estado: 'pending' }, // por cobrar este mes
    { dueDate: '2026-10-01', amount: 500, source: 'installment', estado: 'pending' },
    { dueDate: '2026-08-20', amount: 400, source: 'installment', estado: 'pending' }, // mes pasado → confirmado
    { dueDate: '2026-08-20', amount: 700, source: 'installment', estado: 'overdue' }, // impago → fuera del desglose
  ]
  const porMes = (filas, ymActual) => {
    const mapa = new Map()
    for (const f of filas) {
      if (f.estado === 'overdue') continue // impagos aparte
      const ym = (f.dueDate || '').slice(0, 7)
      if (!ym) continue
      const e = mapa.get(ym) ?? { confirmado: 0, porCobrar: 0 }
      if (f.source === 'review' || ym < ymActual) e.confirmado += f.amount
      else e.porCobrar += f.amount
      mapa.set(ym, e)
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
  }
  const meses = porMes(filas, '2026-09')
  assert.deepEqual(meses, [
    ['2026-08', { confirmado: 400, porCobrar: 0 }],
    ['2026-09', { confirmado: 300, porCobrar: 200 }],
    ['2026-10', { confirmado: 0, porCobrar: 500 }],
  ])
})
