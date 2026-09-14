import assert from 'node:assert/strict'
import test from 'node:test'
import { businessToday, businessYm } from '../../lib/dates/business.ts'

// El tramo del rep (y con él su % de comisión) se mide por el mes EN CURSO. El dashboard lo calcula
// en el navegador —hora de España— y el servidor lo hacía con toISOString(), que es UTC: entre las
// 22:00/23:00 y medianoche del último día de mes, servidor y pantalla estaban en meses distintos.
test('el mes en curso es el del negocio, no el de UTC', () => {
  // 1 de octubre, 00:30 en Madrid (verano, UTC+2) = 30 de septiembre 22:30 UTC.
  const madrugadaOctubre = new Date('2026-09-30T22:30:00Z')
  assert.equal(
    madrugadaOctubre.toISOString().slice(0, 7),
    '2026-09',
    'el caso solo tiene sentido si UTC dice septiembre'
  )
  assert.equal(businessYm(madrugadaOctubre), '2026-10')

  // 1 de enero, 00:30 en Madrid (invierno, UTC+1) = 31 de diciembre 23:30 UTC. Cambio de AÑO.
  const madrugadaEnero = new Date('2026-12-31T23:30:00Z')
  assert.equal(businessYm(madrugadaEnero), '2027-01')

  // Y a mediodía coinciden, claro.
  assert.equal(businessYm(new Date('2026-06-15T12:00:00Z')), '2026-06')
})

// El "hoy" del servidor tiene que ser el del negocio: con la fecha UTC, una cuota que vence hoy en
// España se marcaba vencida (o no) según la hora a la que corriera el cron, y el plazo de devolución
// se comparaba contra el día anterior.
test('el hoy del servidor es el del negocio, no el de UTC', () => {
  // 23:30 UTC del 31 de enero = 00:30 del 1 de febrero en Madrid (invierno, UTC+1).
  const nocheEnero = new Date('2026-01-31T23:30:00Z')
  assert.equal(nocheEnero.toISOString().slice(0, 10), '2026-01-31')
  assert.equal(businessToday(nocheEnero), '2026-02-01')

  // 22:30 UTC del 30 de junio = 00:30 del 1 de julio en Madrid (verano, UTC+2).
  assert.equal(businessToday(new Date('2026-06-30T22:30:00Z')), '2026-07-01')

  // Y a media tarde coinciden.
  assert.equal(businessToday(new Date('2026-06-15T16:00:00Z')), '2026-06-15')
})
