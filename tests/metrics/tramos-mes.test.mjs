import assert from 'node:assert/strict'
import test from 'node:test'
import { businessYm } from '../../lib/commissions/tramos.ts'

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
