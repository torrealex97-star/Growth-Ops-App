import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const WEBHOOK = 'app/api/[tenant]/evergreen/webhooks/fathom/route.ts'
// Se comprueba el CÓDIGO, no los comentarios.
const code = () =>
  read(WEBHOOK)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

// WEBHOOK DE FATHOM. Firma estilo Svix (documentación oficial de Fathom): cabeceras webhook-id,
// webhook-timestamp y webhook-signature; HMAC-SHA256 (base64) de `${id}.${timestamp}.${body}` con
// el material base64 que va tras el prefijo whsec_ del secreto; tolerancia de ±5 minutos.

test('el webhook es fail-closed: sin secreto configurado no entra nada', () => {
  const c = code()
  // El secreto sale de la subcuenta (con el env como respaldo) y sin él se rechaza TODO.
  assert.match(c, /FATHOM_WEBHOOK_SECRET/)
  assert.match(c, /if \(!secreto \|\| !verifyFathomSignature\(/)
  // Subcuenta inexistente y firma inválida responden IGUAL: el endpoint no puede usarse para
  // averiguar qué subcuentas existen ni cuáles tienen webhook configurado.
  const rechazos = c.match(/error: 'Firma inválida'/g) ?? []
  assert.equal(rechazos.length, 2, 'el rechazo debe ser idéntico en los dos caminos')
})

test('la firma se verifica al estilo Svix con tolerancia de replay', () => {
  const c = code()
  assert.match(c, /webhook-id/)
  assert.match(c, /webhook-timestamp/)
  assert.match(c, /webhook-signature/)
  assert.match(c, /createHmac\('sha256'/)
  assert.match(c, /timingSafeEqual/, 'la comparación de firmas debe ser en tiempo constante')
  // Cinco minutos de tolerancia contra replays, como en la doc de Fathom.
  assert.match(c, /300/)
  // El material del secreto es lo que va tras el prefijo whsec_.
  assert.match(c, /split\('_'\)\[1\]/)
  // El cuerpo firmado es el RAW, antes de cualquier parseo JSON.
  assert.match(c, /verifyFathomSignature\(raw/)
})

test('la ingesta es la canónica y el webhook no decide por su cuenta', () => {
  const c = code()
  assert.match(c, /from '@\/lib\/fathom\/ingesta'/)
  assert.match(c, /procesarMeetingFathom\(/)
  // Ni una escritura directa: emparejar, escribir o encolar es de la ingesta compartida.
  assert.doesNotMatch(c, /from\('appointments'\)/)
  assert.doesNotMatch(c, /from\('fathom_match_review'\)/)
  // El payload trae transcripción y resumen: cero llamadas a la API de Fathom en el webhook.
  assert.doesNotMatch(c, /api\.fathom\.ai/)
  // Un cuerpo roto es 400 con registro, no un 500 mudo (mismo criterio que Calendly).
  assert.match(c, /error: 'JSON inválido'/)
  // Sin identificador estable se acusa recibo sin escribir, para que Fathom no reintente eternamente.
  assert.match(c, /omitida: 'sin_identificador'/)
})

test('la guía de Integraciones enseña la dirección y pide el secreto', () => {
  const catalog = read('lib/integrations-catalog.ts')
  assert.match(catalog, /webhookPath: '\/api\/\{tenant\}\/evergreen\/webhooks\/fathom'/)
  assert.match(catalog, /FATHOM_WEBHOOK_SECRET/)
  // El paso dice de dónde sale el secreto y qué pasa si falta (whsec_).
  const guia = catalog.slice(catalog.indexOf("id: 'fathom'"), catalog.indexOf("id: 'email'")).toLowerCase()
  assert.match(guia, /whsec_/)
  assert.match(guia, /destination url/)
})
