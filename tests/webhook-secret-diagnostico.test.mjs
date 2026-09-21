import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { isValidWebhookSecret, huellaSecret, diagnosticoCabeceras } from '../lib/webhooks/verifySecret.ts'

// Secretos de webhook: comparación timing-safe + diagnóstico de transporte para la cabecera
// x-ghl-secret de GHL, cuya herramienta simple de webhooks NO puede enviar cabeceras.

// ── isValidWebhookSecret (comportamiento previo, sin cambios) ──────────────────────────────

test('comparación timing-safe: igual valor pasa, distinto falla, faltantes fallan', () => {
  assert.equal(isValidWebhookSecret('abc123', 'abc123'), true)
  assert.equal(isValidWebhookSecret('abc124', 'abc123'), false)
  assert.equal(isValidWebhookSecret(null, 'abc123'), false)
  assert.equal(isValidWebhookSecret('abc123', undefined), false)
  assert.equal(isValidWebhookSecret('', 'abc123'), false)
})

// ── huellaSecret ─────────────────────────────────────────────────────────────

test('huellaSecret: sha256 truncado a 8 hex, determinista y jamás el valor', () => {
  const h = huellaSecret('pit-secreto-de-verdad-123')
  assert.equal(h, createHash('sha256').update('pit-secreto-de-verdad-123', 'utf8').digest('hex').slice(0, 8))
  assert.equal(h, huellaSecret('pit-secreto-de-verdad-123'), 'determinista')
  assert.match(h ?? '', /^[0-9a-f]{8}$/)
  assert.ok(!String(h).includes('secreto'), 'la huella no puede contener el valor')
})

test('huellaSecret: valores vacíos no producen huella', () => {
  assert.equal(huellaSecret(null), null)
  assert.equal(huellaSecret(''), null)
  assert.equal(huellaSecret(undefined), null)
})

// ── diagnosticoCabeceras ─────────────────────────────────────────────────────

function headersDe(entries) {
  const h = new Headers()
  for (const [k, v] of entries) h.set(k, v)
  return h
}

test('cabecera presente y correcta: coincide_con_panel true y sin pista', () => {
  const d = diagnosticoCabeceras(headersDe([['x-ghl-secret', 'pit-A1']]), 'pit-A1')
  assert.equal(d.cabecera_presente, true)
  assert.equal(d.coincide_con_panel, true)
  assert.equal(d.pista, null)
  assert.equal(d.huella_recibida, huellaSecret('pit-A1'))
  assert.deepEqual(d.cabecera_nombre_recibida, ['x-ghl-secret'])
})

test('el matching es case-insensitive: el runtime normaliza el nombre a minúsculas (spec fetch)', () => {
  // GHL o un proxy intermedio pueden variar el casing (HTTP/2 lo envía siempre en minúsculas);
  // Headers.get/keys lo normalizan, así que el matching no depende de cómo lo mande el emisor.
  const d = diagnosticoCabeceras(headersDe([['X-GHL-Secret', 'pit-A1']]), 'pit-A1')
  assert.equal(d.cabecera_presente, true)
  assert.equal(d.coincide_con_panel, true)
  assert.deepEqual(d.cabecera_nombre_recibida, ['x-ghl-secret'])
})

test('cabecera ausente: pista apunta a la herramienta simple de GHL (sin cabeceras)', () => {
  const d = diagnosticoCabeceras(new Headers(), 'pit-A1')
  assert.equal(d.cabecera_presente, false)
  assert.equal(d.coincide_con_panel, null)
  assert.equal(d.longitud_recibida, null)
  assert.match(d.pista ?? '', /no puede enviar cabeceras/)
})

test('los espacios alrededor del valor los recorta el runtime (spec fetch): no llegan sobrantes', () => {
  // Headers normaliza el valor al construirse: si en el panel se pegó con espacios, esos espacios
  // se pierden ANTES de nuestra comparación — por eso aquí coincide sin pista. La comparación con
  // trim del módulo queda como defensa para quien invoque con un Headers no estándar.
  const d = diagnosticoCabeceras(headersDe([['x-ghl-secret', '  pit-A1  ']]), 'pit-A1')
  assert.equal(d.coincide_con_panel, true)
  assert.equal(d.pista, null)
})

test('valor distinto con misma longitud: el pegado en GHL no es el del panel', () => {
  const d = diagnosticoCabeceras(headersDe([['x-ghl-secret', 'pit-B2']]), 'pit-A1')
  assert.equal(d.coincide_con_panel, false)
  assert.match(d.pista ?? '', /no es el del panel/)
})

test('valor truncado (longitud distinta): pista de incompleto, no de valor erróneo', () => {
  const d = diagnosticoCabeceras(headersDe([['x-ghl-secret', 'pit-A']]), 'pit-A1')
  assert.equal(d.coincide_con_panel, false)
  assert.match(d.pista ?? '', /longitud distinta/)
})

test('sin secret en el panel: pista de configuración, no de transporte', () => {
  const d = diagnosticoCabeceras(headersDe([['x-ghl-secret', 'cualquiera']]), undefined)
  assert.equal(d.panel_configurado, false)
  assert.equal(d.coincide_con_panel, null)
  assert.match(d.pista ?? '', /panel de Integraciones no tiene/)
})

test('el diagnóstico jamás incluye el valor del secret ni del panel', () => {
  // Valor fijo SIN palabras clave tipo secret/key: gitleaks debe ver un fixture falso, no una clave.
  const valorFijo = 'pit-fake-9876-valor'
  const d = diagnosticoCabeceras(headersDe([['x-ghl-secret', valorFijo]]), valorFijo)
  const serializado = JSON.stringify(d)
  assert.ok(!serializado.includes(valorFijo), 'la respuesta del diagnóstico no puede llevar el valor')
})
