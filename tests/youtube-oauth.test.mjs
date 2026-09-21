// Flujo OAuth de YouTube (21-sep): el cliente OAuth de YouTube de las subcuentas SOLO tiene
// registrado el redirect del playground (verificado contra Google: el callback de la app da
// redirect_uri_mismatch), así que el flujo es de dos pasos con intercambio server-side:
//   1) la UI abre Google con redirect=playground (client+secret guardados en Integraciones),
//   2) el admin pega el código que Google muestra y el servidor lo intercambia + guarda cifrado
//      como YOUTUBE_REFRESH_TOKEN — la clave exacta que leen la sonda del panel y el backfill.
// Los módulos TS con imports de '@/...' no se importan desde tests .mjs: se verifica el fuente
// (patrón del repo: tests/social-research.test.mjs) y se replica la lógica pura.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = dirname(aqui)
const lee = (p) => readFileSync(join(raiz, p), 'utf8')
const ROUTE = 'app/api/[tenant]/evergreen/settings/integraciones/route.ts'
const UI = 'app/[tenant]/settings/integraciones/page.tsx'

test('el intercambio exige sesión admin, código presente y credenciales de YouTube guardadas', () => {
  const route = lee(ROUTE)
  // La acción cuelga del POST de requireAdmin (no hay camino sin sesión).
  assert.match(route, /action === 'youtube-exchange'/)
  assert.match(route, /async function exchangeYoutubeCode\(tenantId: string, code: string\)/)
  assert.match(route, /if \(!limpio\)\s*\n?\s*return NextResponse\.json/, 'rechaza código vacío')
  assert.match(route, /Guarda primero el Client ID y el Client Secret de YouTube\./)
})

test('acepta el código pelado o la URL completa del playground', () => {
  const route = lee(ROUTE)
  assert.match(route, /\[?&\]code=\(\[\^&\]\+\)/)
  assert.match(route, /decodeURIComponent\(extraido\[1\]\)/, 'los códigos vienen percent-encoded en la URL')
  // Réplica pura congelada del extractor:
  const extrae = (s) => {
    const m = s.match(/[?&]code=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : s
  }
  assert.equal(extrae('4/0AQSTgQF9xyz-abc_DEF.123'), '4/0AQSTgQF9xyz-abc_DEF.123')
  assert.equal(
    extrae('https://developers.google.com/oauthplayground/?code=4%2F0Axyz-abc.def&scope=x'),
    '4/0Axyz-abc.def'
  )
  assert.equal(extrae('https://developers.google.com/oauthplayground/?code=4/0Axyz-abc.def&scope=x'), '4/0Axyz-abc.def')
  assert.equal(extrae('https://developers.google.com/oauthplayground/?code=4%2F0A%2Bx&scope=y'), '4/0A+x')
})

test('el intercambio usa el redirect del playground y las credenciales de YouTube de la subcuenta', () => {
  const route = lee(ROUTE)
  assert.match(route, /exchangeCode\(/)
  assert.match(route, /'https:\/\/developers\.google\.com\/oauthplayground'/)
  assert.match(route, /clientId: cfg\.YOUTUBE_CLIENT_ID/)
  assert.match(route, /clientSecret: cfg\.YOUTUBE_CLIENT_SECRET/)
  assert.match(route, /invalid_grant/, 'mensaje accionable cuando el código caducó o ya se usó')
})

test('sin youtube.upload concedido no se guarda nada: subir Shorts lo exige', () => {
  const route = lee(ROUTE)
  assert.match(route, /granted\.includes\('https:\/\/www\.googleapis\.com\/auth\/youtube\.upload'\)/)
})

test('el refresh token se guarda CIFRADO en integration_settings con la clave de sonda y backfill', () => {
  const route = lee(ROUTE)
  assert.match(route, /key: 'YOUTUBE_REFRESH_TOKEN'/)
  assert.match(route, /value: encryptSecret\(token\.refresh_token\)/)
  assert.match(route, /is_secret: true/)
  assert.match(route, /onConflict: 'tenant_id,key'/)
})

test('la UI abre Google con los scopes correctos y completa con el código pegado', () => {
  const ui = lee(UI)
  assert.match(ui, /youtube\.upload https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly/)
  assert.match(ui, /redirect_uri', 'https:\/\/developers\.google\.com\/oauthplayground'/)
  assert.match(ui, /access_type', 'offline'/)
  assert.match(ui, /prompt', 'consent'/, 'consent: sin esto Google no devuelve refresh_token en reautorizaciones')
  assert.match(ui, /action: 'youtube-exchange'/)
  // Guarda client+secret ANTES de abrir Google (Google empareja el token con el client).
  assert.match(ui, /await saveGroup\(g\)/)
})

test('el campo de código es efímero: nunca se persiste como credencial', () => {
  const ui = lee(UI)
  // El draft YOUTUBE_OAUTH_CODE solo viaja a la acción de intercambio, jamás a updates del grupo.
  const bloque = ui.slice(ui.indexOf('YOUTUBE_OAUTH_CODE'), ui.indexOf('YOUTUBE_OAUTH_CODE') + 4000)
  assert.ok(!bloque.includes('updates[f.key]'), 'el código no debe mezclarse con el guardado de campos')
  assert.match(ui, /delete n\.YOUTUBE_OAUTH_CODE/, 'se limpia tras completar')
})
