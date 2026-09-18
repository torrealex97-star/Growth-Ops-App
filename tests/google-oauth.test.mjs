import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const CALLBACK = 'app/api/oauth/google/callback/route.ts'
const START = 'app/api/[tenant]/evergreen/oauth/google/start/route.ts'

// El callback vive fuera de /api/[tenant]/ porque el URI de redirección se registra literalmente en
// Google Cloud. Eso significa que NO puede confiar en el middleware ni en la ruta: su única defensa
// es la firma del state. Si esto se rompiera, cualquiera podría guardar el token de su cuenta de
// Google como la conexión de otra subcuenta.
test('el callback verifica la firma del state antes de cualquier otra cosa', () => {
  const code = read(CALLBACK)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const cuerpo = code.slice(code.indexOf('export async function GET'))
  const posVerify = cuerpo.indexOf('verifyState(')
  assert.ok(posVerify > 0, 'el callback no verifica el state')
  // Nada de intercambiar el código ni tocar la base antes de validar el state.
  assert.ok(cuerpo.indexOf('exchangeCode(') > posVerify, 'se intercambia el código antes de validar el state')
  assert.ok(cuerpo.indexOf("from('tenants')") > posVerify, 'se consulta la subcuenta antes de validar el state')
  // La subcuenta sale del state verificado, nunca de un parámetro de la URL.
  assert.match(cuerpo, /const \{ tenant, provider \} = state\.payload/)
  assert.doesNotMatch(cuerpo, /searchParams\.get\('tenant'\)/)
})

test('el refresh token se guarda cifrado y el access token no se guarda', () => {
  const code = read(CALLBACK)
  assert.match(code, /refresh_token: encryptSecret\(token\.refresh_token\)/)
  // El access token caduca en una hora: guardarlo solo añadiría otra credencial a proteger.
  assert.doesNotMatch(code, /access_token: token\.access_token/)
})

test('sin refresh token no se guarda una conexión a medias', () => {
  const code = read(CALLBACK)
  assert.match(code, /token\.error \|\| !token\.refresh_token/)
  assert.match(code, /sin_refresh_token/)
})

test('se guardan los ámbitos concedidos, no los pedidos', () => {
  const code = read(CALLBACK)
  // El usuario puede desmarcar permisos en la pantalla de consentimiento.
  assert.match(code, /const granted = \(token\.scope \|\| ''\)/)
  assert.match(code, /scopes: granted/)
  assert.match(code, /faltan\.length > 0 \? 'error' : 'conectada'/)
})

test('los ámbitos pedidos son todos de solo lectura', () => {
  const lib = read('lib/google/oauth.ts')
  const scopes = lib.slice(lib.indexOf('export const SCOPES'), lib.indexOf('function redirectUri'))
  const encontrados = [...scopes.matchAll(/auth\/([a-z0-9.]+)/g)].map((m) => m[1])
  assert.ok(encontrados.length >= 3, 'no se han encontrado los ámbitos')
  for (const s of encontrados) {
    assert.match(s, /readonly|metadata/, `el ámbito ${s} no es de solo lectura`)
  }
  // Nada de escritura, envío ni borrado.
  assert.doesNotMatch(scopes, /gmail\.send|gmail\.modify|analytics\.edit|drive/)
})

test('el flujo pide offline + consent para recibir refresh token', () => {
  const lib = read('lib/google/oauth.ts')
  // Sin esto Google no devuelve refresh_token en las autorizaciones posteriores a la primera.
  assert.match(lib, /access_type', 'offline'/)
  assert.match(lib, /prompt', 'consent'/)
})

test('el inicio del flujo exige sesión de admin de la subcuenta de la URL', () => {
  const code = read(START)
  assert.match(code, /await requireTenant\(tenant\)/)
  assert.match(code, /session\.role !== 'admin'/)
  assert.match(code, /signState\(\{ tenant, provider \}\)/)
  // Sin CONFIG_ENC_KEY no se puede firmar: antes fallar que seguir sin firma.
  assert.match(code, /catch \(e\)/)
})

test('el callback está declarado como público en el middleware, con motivo', () => {
  const mw = read('middleware.ts')
  assert.match(mw, /'\/api\/oauth\/google\/callback'/)
  // Debe quedar escrito POR QUÉ es público, o el próximo que lo lea pensará que es un descuido.
  assert.match(mw, /state.*FIRMADO|FIRMADO.*state/s)
})

test('la tabla de conexiones no deja leer credenciales al equipo', () => {
  const sql = read('supabase/migrations/20260913160000_google_oauth_connections.sql')
  assert.match(sql, /CREATE POLICY "google_oauth_admin_all"[\s\S]*is_admin_or_director\(\)/)
  // A diferencia de otras tablas, aquí NO hay política de SELECT para todo el equipo.
  assert.doesNotMatch(sql, /get_my_role\(\) IS NOT NULL/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  assert.match(sql, /CREATE UNIQUE INDEX google_oauth_tenant_provider_key[\s\S]*\(tenant_id, provider\)/)
})

// ── Sync de GA4 ─────────────────────────────────────────────────────────────
const GA4_ROUTE = 'app/api/[tenant]/evergreen/ga4/route.ts'

test('el sync de GA4 es idempotente por el grano completo, no solo por la fecha', () => {
  const route = read(GA4_ROUTE)
  // GA4 reprocesa sus datos durante ~48 h, así que volver a pedir los últimos días es lo normal.
  // Sin el grano completo en onConflict, cada pasada duplicaría el histórico.
  assert.match(route, /onConflict: 'tenant_id,date,source,medium,campaign,landing_page,device'/)
  assert.match(read('supabase/migrations/20260913170000_ga4_daily.sql'), /ga4_daily_grain_key/)
})

test('el sync cuenta lo escrito de verdad y distingue acceso revocado', () => {
  const route = read(GA4_ROUTE)
  assert.match(route, /\.select\('id'\)/, 'no comprueba qué filas se escribieron')
  assert.match(route, /escritas \+= data\?\.length \?\? 0/)
  // invalid_grant es "hay que volver a conectar", no un fallo temporal que reintentar.
  assert.match(read('lib/google/ga4.ts'), /invalid_grant/)
  assert.match(route, /revocada/)
  assert.match(route, /dryRun/)
})

test('las dimensiones de la tabla son NOT NULL con DEFAULT, no nullable', () => {
  // En Postgres NULL != NULL, así que con dimensiones nullable la clave única dejaría de proteger
  // contra duplicados y el histórico se duplicaría en silencio.
  const sql = read('supabase/migrations/20260913170000_ga4_daily.sql')
  for (const col of ['source', 'medium', 'campaign', 'landing_page', 'device']) {
    assert.match(sql, new RegExp(`${col}\\s+TEXT NOT NULL DEFAULT ''`), `${col} debería ser NOT NULL DEFAULT ''`)
  }
})

// Funnels lee la tabla local, no la API: la pantalla no debe depender de una llamada externa.
test('Funnels lee GA4 de la base y distingue "sin conectar" de "cero sesiones"', () => {
  const q = read('lib/funnels/queries.ts')
  assert.match(q, /from\('ga4_daily'\)/)
  assert.doesNotMatch(q, /analyticsdata\.googleapis\.com/)
  // Cada motivo distinto tiene su mensaje: sin conexión, sin propiedad, sin sincronizar, revocada.
  assert.match(q, /GA4 no está conectado en esta subcuenta/)
  assert.match(q, /no se ha elegido ninguna propiedad/)
  assert.match(q, /todavía no se ha sincronizado/)
  assert.match(q, /revocó el acceso/)
  // El mensaje viejo de "falta el proyecto de Google Cloud" ya no aplica: el proyecto existe.
  assert.doesNotMatch(q, /falta el proyecto de Google Cloud/)
})
