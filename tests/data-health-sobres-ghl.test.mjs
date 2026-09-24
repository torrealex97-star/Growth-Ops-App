import assert from 'node:assert/strict'
import test from 'node:test'

import { SILENCIO_WEBHOOK_MS, saludSobreGhl } from '../lib/data-health/webhooks.ts'

// EL CONTROL NO PUEDE MENTIR: "al día" solo con evidencia real (un sobre en raw_events), un hueco
// no es un cero (fallo de lectura → desconocido, nunca "al día") y una integración que la
// subcuenta no usa no es avería. Auditoría del 23-sep: GHL enviaba y la app lo tragaba en
// silencio; nadie miraba la mitad receptora.

const AHORA = Date.parse('2026-09-24T10:00:00Z')
const HACE_2H = '2026-09-24T08:00:00Z'
const HACE_30H = '2026-09-23T04:00:00Z'

test('sobre reciente → al día, con horas redondeadas', () => {
  const s = saludSobreGhl({ configurado: true, ultimoSobre: HACE_2H, ahora: AHORA })
  assert.equal(s.estado, 'al_dia')
  assert.equal(s.horasDesde, 2)
  assert.equal(s.ultimoSobre, HACE_2H)
})

test('más de 24h sin sobres con GHL configurado → silencio (el caso real del 22-sep)', () => {
  const s = saludSobreGhl({ configurado: true, ultimoSobre: HACE_30H, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.equal(s.horasDesde, 30)
  assert.match(s.mensaje, /30 h/)
})

test('GHL configurado y cero sobres históricos → silencio (alta sin funcionar)', () => {
  const s = saludSobreGhl({ configurado: true, ultimoSobre: null, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.equal(s.horasDesde, null)
  assert.match(s.mensaje, /nunca ha recibido/)
})

test('integración no usada → sin_configurar, nunca avería', () => {
  const s = saludSobreGhl({ configurado: false, ultimoSobre: null, ahora: AHORA })
  assert.equal(s.estado, 'sin_configurar')
})

test('sin_configurar no avisa aunque no haya sobres', () => {
  const s = saludSobreGhl({ configurado: false, ultimoSobre: null, ahora: AHORA })
  assert.notEqual(s.estado, 'silencio')
})

test('capa en bruto no leíble → desconocido, jamás "al día" (un hueco no es un cero)', () => {
  const s = saludSobreGhl({ configurado: true, ultimoSobre: null, leido: false, ahora: AHORA })
  assert.equal(s.estado, 'desconocido')
})

test('fecha ilegible → desconocido, no se asume fresca', () => {
  const s = saludSobreGhl({ configurado: true, ultimoSobre: 'no-es-una-fecha', ahora: AHORA })
  assert.equal(s.estado, 'desconocido')
})

test('el umbral exacto (24h) ya cuenta como silencio', () => {
  const hace24h = '2026-09-23T10:00:00Z'
  const s = saludSobreGhl({ configurado: true, ultimoSobre: hace24h, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.equal(SILENCIO_WEBHOOK_MS, 24 * 60 * 60 * 1000)
})

test('un milisegundo antes del umbral sigue al día', () => {
  const casi = new Date(AHORA - SILENCIO_WEBHOOK_MS + 1).toISOString()
  const s = saludSobreGhl({ configurado: true, ultimoSobre: casi, ahora: AHORA })
  assert.equal(s.estado, 'al_dia')
})

test('umbral personalizable (la función no hardcodea la política)', () => {
  const s = saludSobreGhl({ configurado: true, ultimoSobre: HACE_2H, umbralMs: 3_600_000, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
})
