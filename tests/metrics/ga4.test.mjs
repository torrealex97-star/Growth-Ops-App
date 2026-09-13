import assert from 'node:assert/strict'
import test from 'node:test'
import { mapReportRows, normalizeDimension, normalizeGa4Date } from '../../lib/google/ga4.ts'

// GA4 marca la ausencia de valor con varias cadenas distintas. Si entraran tal cual, el mismo
// tráfico directo aparecería como fuentes diferentes según el día y el histórico quedaría
// fragmentado sin que nadie entienda por qué.
test('los marcadores de "sin valor" de GA4 se normalizan a cadena vacía', () => {
  for (const v of ['(not set)', '(none)', '(direct)', '(other)', '(NOT SET)', '  ', '', null, undefined]) {
    assert.equal(normalizeDimension(v), '', String(v))
  }
  assert.equal(normalizeDimension('  google  '), 'google')
  assert.equal(normalizeDimension('Instagram'), 'Instagram')
})

test('las fechas de GA4 se convierten de YYYYMMDD a ISO', () => {
  assert.equal(normalizeGa4Date('20260913'), '2026-09-13')
  for (const malo of ['2026-09-13', '2026913', 'ayer', '', '  ']) {
    assert.equal(normalizeGa4Date(malo), null, malo)
  }
})

const row = (dims, mets) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: mets.map((value) => ({ value })),
})

test('una fila se mapea posicionalmente a las columnas correctas', () => {
  const [r] = mapReportRows({
    rows: [row(['20260901', 'google', 'organic', 'marca', '/precios', 'mobile'], ['120', '90', '30', '4', '80'])],
  })
  assert.deepEqual(r, {
    date: '2026-09-01',
    source: 'google',
    medium: 'organic',
    campaign: 'marca',
    landing_page: '/precios',
    device: 'mobile',
    sessions: 120,
    active_users: 90,
    new_users: 30,
    conversions: 4,
    engaged_sessions: 80,
  })
})

test('una fila sin fecha válida se descarta en vez de inventar un día', () => {
  const out = mapReportRows({
    rows: [row(['basura', 'google', 'organic', '', '', ''], ['1', '1', '1', '0', '1'])],
  })
  assert.equal(out.length, 0)
})

test('una métrica no numérica o negativa se trata como 0, no como NaN', () => {
  // NaN rompería el CHECK de la tabla y abortaría la pasada entera por una fila rara.
  const [r] = mapReportRows({
    rows: [row(['20260901', 'x', '', '', '', ''], ['no-es-un-numero', '-5', '', 'NaN', '7'])],
  })
  assert.equal(r.sessions, 0)
  assert.equal(r.active_users, 0)
  assert.equal(r.new_users, 0)
  assert.equal(r.conversions, 0)
  assert.equal(r.engaged_sessions, 7)
  for (const v of Object.values(r)) assert.ok(!Number.isNaN(v))
})

test('faltar dimensiones o métricas no rompe el mapeo', () => {
  const [r] = mapReportRows({ rows: [{ dimensionValues: [{ value: '20260901' }], metricValues: [] }] })
  assert.equal(r.date, '2026-09-01')
  assert.equal(r.source, '')
  assert.equal(r.sessions, 0)
})

test('una respuesta vacía o sin rows devuelve lista vacía, no un error', () => {
  assert.deepEqual(mapReportRows({}), [])
  assert.deepEqual(mapReportRows({ rows: [] }), [])
})
