import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// Fase C del pixel first-party: la capa de aplicación sobre el modelo ya migrado (Fase B).
const { TRACKER_JS } = await import('../lib/tracking/tracker-js.ts')

test('el SDK del pixel no contiene PII ni secretos', () => {
  assert.equal(TRACKER_JS.includes('SUPABASE'), false, 'el SDK no puede referenciar credenciales')
  assert.equal(TRACKER_JS.includes('service'), false)
  assert.equal(TRACKER_JS.includes('Bearer'), false)
  // No recoge email/teléfono por su cuenta: los props los manda la página de forma explícita.
  assert.doesNotMatch(TRACKER_JS, /document\.(querySelector|getElementById)/, 'el SDK no espía el DOM')
})

test('el SDK genera anon id persistente y sesión por pestaña', () => {
  assert.match(TRACKER_JS, /gop_aid/)
  assert.match(TRACKER_JS, /localStorage\.getItem\(AID_KEY\)/)
  assert.match(TRACKER_JS, /sessionStorage\.getItem\(SID_KEY\)/, 'la sesión es de sessionStorage, no permanente')
})

test('el SDK envía UTMs y click ids y auto-trackea page_view', () => {
  for (const attr of ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'ttclid']) {
    assert.ok(TRACKER_JS.includes(`'${attr}'`), `falta ${attr}`)
  }
  assert.match(TRACKER_JS, /sendBeacon/, 'debe preferir sendBeacon')
  assert.match(TRACKER_JS, /send\('page_view'\)/, 'page_view automático en carga')
  assert.match(TRACKER_JS, /pushState/, 'page_view también en navegación SPA')
})

test('la ruta /tracker.js sirve el SDK como asset con cache', () => {
  const route = read('app/tracker.js/route.ts')
  assert.match(route, /application\/javascript/)
  assert.match(route, /Cache-Control/)
  assert.doesNotMatch(route, /requireTenant/, 'es un asset, no una API con sesión')
})

test('el endpoint de ingesta autentica por public_key y valida origin', () => {
  const route = read('app/api/track/[site]/route.ts')
  // La clave pública es la credencial: formato exacto antes de tocar BD.
  assert.match(route, /gop_pk_\[A-Za-z0-9_-\]\{32,64\}/)
  assert.match(route, /originAllowed/)
  assert.match(route, /tracking_enabled/, 'respeta el interruptor por site')
  assert.match(route, /limiter\.allow/, 'rate limit por clave')
  assert.match(route, /ALLOWED_EVENTS/, 'allowlist de nombres de evento')
  // Escribe la capa RAW siempre, aunque la normalización falle después (§8: nada se pierde).
  assert.match(route, /from\('raw_events'\)/)
  assert.match(route, /bot_classification/)
  assert.match(route, /ip_hash/, 'nunca la IP en claro')
  // Aislamiento: todo lo derivado lleva tenant_id del SITE resuelto por la clave, no del cliente.
  assert.doesNotMatch(route, /body\.tenant_id/)
})

test('el endpoint está accesible sin sesión (middleware PUBLIC_PATHS)', () => {
  const mw = read('middleware.ts')
  assert.match(mw, /'\/api\/track'/)
})

test('sites API: gestión reservada a dirección y estado con datos reales', () => {
  const route = read('app/api/[tenant]/evergreen/tracking/sites/route.ts')
  for (const method of ['POST', 'PATCH']) {
    const idx = route.indexOf(`export async function ${method}`)
    assert.ok(idx > 0, `falta ${method}`)
    const bloque = route.slice(idx)
    assert.match(bloque, /administraTenant/, `${method} debe exigir administración de la subcuenta`)
  }
  assert.match(route, /events24h/, 'Data Health muestra eventos reales de 24h')
  assert.match(route, /lastEventAt/, 'y el último evento recibido')
  assert.match(route, /newPublicKey\(\)/, 'la clave la genera el servidor')
})

test('el snippet nunca habilita tracking solo: arranca apagado en la alta', () => {
  const route = read('app/api/[tenant]/evergreen/tracking/sites/route.ts')
  assert.match(route, /tracking_enabled: false/)
})

test('Data Health monta el panel del pixel', () => {
  const panel = read('components/settings/DataHealthPanel.tsx')
  assert.match(panel, /TrackingSitesPanel/)
  const section = read('components/settings/TrackingSitesPanel.tsx')
  // El estado del pixel usa datos REALES: eventos 24h, errores y último evento (§10 del brief).
  for (const campo of ['events24h', 'errors24h', 'lastEventAt', 'tracking_enabled']) {
    assert.ok(section.includes(campo), `falta ${campo} en la sección del pixel`)
  }
  assert.match(section, /tracker\.js/, 'ofrece el snippet instalable')
})
