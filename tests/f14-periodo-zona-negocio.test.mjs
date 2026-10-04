import assert from 'node:assert/strict'
import test from 'node:test'
import { getPeriodRange, inPeriod, toDateInputValue } from '../lib/filters/period.ts'

const iso = (r) => [r.from?.toISOString() ?? null, r.to?.toISOString() ?? null]
// 22:30 UTC del 4-oct = 00:30 del día 5 en Madrid (CEST, +2).
const ahora = new Date('2026-10-04T22:30:00Z')

test('"hoy" es el día de Madrid aunque el reloj esté en el día anterior en UTC', () => {
  assert.deepEqual(iso(getPeriodRange('today', '', '', {}, ahora)), [
    '2026-10-04T22:00:00.000Z',
    '2026-10-05T21:59:59.999Z',
  ])
})

test('el mes cruza el cambio de hora sin perder ni ganar horas en los bordes', () => {
  assert.deepEqual(iso(getPeriodRange('month', '', '', {}, ahora)), [
    '2026-09-30T22:00:00.000Z',
    '2026-10-31T22:59:59.999Z',
  ])
})

test('la semana empieza en lunes y 7d son siete días calendario', () => {
  const sem = getPeriodRange('week', '', '', {}, ahora) // 5-oct-2026 es lunes
  assert.equal(sem.from.toISOString(), '2026-10-04T22:00:00.000Z')
  assert.equal(sem.to.toISOString(), '2026-10-11T21:59:59.999Z')
  const d7 = getPeriodRange('7d', '', '', {}, ahora)
  assert.equal(d7.from.toISOString(), '2026-09-28T22:00:00.000Z')
})

test('un rango personalizado y una fecha sin hora se leen en la zona del negocio', () => {
  const r = getPeriodRange('custom', '2026-10-05', '2026-10-05')
  assert.equal(inPeriod('2026-10-05', r), true)
  assert.equal(inPeriod('2026-10-04', r), false)
  assert.equal(inPeriod('2026-10-05T21:59:00Z', r), true)
  assert.equal(inPeriod('2026-10-05T22:00:00Z', r), false)
})

test('toDateInputValue da la fecha de Madrid', () => {
  assert.equal(toDateInputValue(ahora), '2026-10-05')
})

test('ninguna consulta de citas corta el día con una hora sin zona (se leería en UTC)', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of [
    'app/[tenant]/marketing/adquisicion/atribucion/page.tsx',
    'app/api/[tenant]/evergreen/meta/daily-funnel/route.ts',
    'app/api/[tenant]/evergreen/kpi/auto/route.ts',
  ]) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.doesNotMatch(s, /appointment_datetime',\s*`\$\{[a-zA-Z]+\}T(00:00:00|23:59:59)`/, f)
    assert.doesNotMatch(s, /const start = `\$\{date\}T00:00:00`/, f)
  }
})
