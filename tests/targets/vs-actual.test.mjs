import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluaTarget, eligeTarget, valorTarget, METRICAS_CON_OBJETIVO } from '../../lib/targets/vs-actual.ts'

// ── ESTADOS CON COLOR (§29) ───────────────────────────────────────────────────

test('actual ≥ target → verde', () => {
  assert.equal(evaluaTarget(30_000, 25_000).estado, 'verde')
})

test('dentro del 10% por debajo → ámbar', () => {
  assert.equal(evaluaTarget(23_000, 25_000).estado, 'ambar')
})

test('por debajo del margen → rojo', () => {
  const r = evaluaTarget(20_000, 25_000)
  assert.equal(r.estado, 'rojo')
  assert.equal(r.gap, -5_000)
})

test('exactamente el 90% del target → ámbar (límite incluido)', () => {
  assert.equal(evaluaTarget(22_500, 25_000).estado, 'ambar')
  assert.equal(evaluaTarget(22_499, 25_000).estado, 'rojo')
})

// ── DIRECCIÓN: CAC mejora BAJANDO ─────────────────────────────────────────────

test('CAC bajo el target → verde (menor_mejor)', () => {
  const r = evaluaTarget(800, 1_000, 'menor_mejor')
  assert.equal(r.estado, 'verde')
  assert.equal(r.gap, -200)
})

test('CAC cerca del target → ámbar', () => {
  assert.equal(evaluaTarget(1_050, 1_000, 'menor_mejor').estado, 'ambar')
})

test('CAC muy por encima → rojo', () => {
  assert.equal(evaluaTarget(1_400, 1_000, 'menor_mejor').estado, 'rojo')
})

// ── 0 ≠ NULL (§39): sin target o sin dato NO hay color ────────────────────────

test('sin target → sin_target, sin gap inventado', () => {
  const r = evaluaTarget(30_000, null)
  assert.equal(r.estado, 'sin_target')
  assert.equal(r.gap, null)
  assert.equal(r.porcentaje, null)
})

test('actual no calculable → sin_dato (no 0)', () => {
  const r = evaluaTarget(null, 25_000)
  assert.equal(r.estado, 'sin_dato')
  assert.equal(r.gap, null)
})

test('target 0 no divide: porcentaje null pero gap real', () => {
  const r = evaluaTarget(500, 0)
  assert.equal(r.estado, 'verde')
  assert.equal(r.porcentaje, null)
  assert.equal(r.gap, 500)
})

// ── CATÁLOGO: claves compartidas con lib/analytics.ts ─────────────────────────

test('las claves del catálogo incluyen las de targetCurrentValue', () => {
  const keys = METRICAS_CON_OBJETIVO.map((m) => m.key)
  for (const k of ['revenue', 'cash_collected', 'sales_count']) assert.ok(keys.includes(k), `falta ${k}`)
  assert.ok(METRICAS_CON_OBJETIVO.every((m) => m.direccion === 'mayor_mejor' || m.direccion === 'menor_mejor'))
})

// ── SELECCIÓN DEL TARGET VIGENTE ─────────────────────────────────────────────

const t = (over = {}) => ({
  metric_key: 'revenue',
  scope_type: 'company',
  is_active: true,
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  target_value: 30_000,
  ...over,
})

test('elige el target cuya ventana solapa con el periodo visible', () => {
  const elegido = eligeTarget(
    [
      t({ period_start: '2026-08-01', period_end: '2026-08-31' }),
      t({ period_start: '2026-09-01', period_end: '2026-09-30', target_value: 40_000 }),
    ],
    'revenue',
    '2026-09-10',
    '2026-09-17'
  )
  assert.equal(elegido?.target_value, 40_000)
})

test('sin solape con el periodo → null (no compara ventanas distintas)', () => {
  const elegido = eligeTarget(
    [t({ period_start: '2026-08-01', period_end: '2026-08-31' })],
    'revenue',
    '2026-09-10',
    '2026-09-17'
  )
  assert.equal(elegido, null)
})

test('con "todo" usa el objetivo vigente que contiene HOY', () => {
  const elegido = eligeTarget(
    [
      t({ period_start: '2026-01-01', period_end: '2026-12-31', target_value: 99_000 }),
      t({ period_start: '2026-03-01', period_end: '2026-03-31' }),
    ],
    'revenue',
    null,
    null,
    '2026-06-15'
  )
  assert.equal(elegido?.target_value, 99_000)
})

test('empate de solape → gana el period_start más reciente', () => {
  const elegido = eligeTarget(
    [t({ period_start: '2026-09-01', target_value: 10_000 }), t({ period_start: '2026-09-05', target_value: 20_000 })],
    'revenue',
    '2026-09-10',
    '2026-09-17'
  )
  assert.equal(elegido?.target_value, 20_000)
})

test('descarta inactivos y otros scopes/métricas', () => {
  const elegido = eligeTarget(
    [t({ is_active: false }), t({ scope_type: 'user' }), t({ metric_key: 'cash_collected' })],
    'revenue',
    '2026-09-10',
    '2026-09-17'
  )
  assert.equal(elegido, null)
})

// ── valorTarget: NUMERIC llega como string ────────────────────────────────────

test('valorTarget acepta string y number', () => {
  assert.equal(
    valorTarget({
      metric_key: 'revenue',
      scope_type: 'company',
      period_start: '',
      period_end: '',
      target_value: '30000',
    }),
    30_000
  )
  assert.equal(
    valorTarget({
      metric_key: 'revenue',
      scope_type: 'company',
      period_start: '',
      period_end: '',
      target_value: 1_500,
    }),
    1_500
  )
  assert.equal(valorTarget(null), null)
})
