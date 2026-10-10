import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// SERVIDOR MCP PROPIO (9-oct).
//
// ChatGPT y Claude leen los datos de la app vía /api/mcp. Invariantes de seguridad que este
// test fija: solo lectura REAL (rol mcp_reader + transacción READ ONLY + análisis previo),
// aislamiento por subcuenta vía request.jwt.claims (el mismo RLS de la sesión web), PKCE S256
// obligatorio, códigos de un solo uso, refresh con rotación y secretos solo como hash.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('el ejecutor SQL es de solo lectura en las tres capas', () => {
  const exec = leer('lib/mcp/sql-executor.ts')
  // Capa Postgres: rol lector dentro de la transacción (el dueño de las tablas se salta RLS).
  assert.match(exec, /set local role mcp_reader/)
  // Transacción READ ONLY: hasta un INSERT en una CTE revienta.
  assert.match(exec, /transaction_read_only = on/)
  // Límites declarados.
  assert.match(exec, /statement_timeout/)
  assert.match(exec, /MAX_ROWS = \d+/)
  // Análisis previo: rechaza escritura y varias sentencias antes de llegar a Postgres.
  const rechazo = exec.slice(exec.indexOf('export function esConsultaSoloLectura'))
  assert.match(rechazo, /insert\|update\|delete/)
  assert.match(rechazo, /;.*\\S/)
})

test('el análisis de consultas solo-lectura rechaza escritura camuflada (casos reales)', async () => {
  const mod = await import('../lib/mcp/sql-executor.ts')
  const ok = [
    'select * from contacts limit 10',
    'WITH t as (select 1) select * from t',
    "SELECT id FROM sales WHERE status = 'active' -- comentario",
    'table tenants',
    "select 'drop table users' as texto_inofensivo", // escritura dentro de un literal
    'select 1; -- solo un comentario al final',
  ]
  for (const q of ok) assert.equal(mod.esConsultaSoloLectura(q), true, q)
  const rechazadas = [
    'drop table users',
    'insert into contacts values (1)',
    'update sales set gross_amount=0',
    'delete from contacts',
    'select 1; drop table users', // segunda sentencia
    "copy contacts to '/tmp/x'",
    "select set_config('request.jwt.claims', '{}', false)", // manipular la sesión RLS
    'select auth.uid() from users; select 1',
  ]
  for (const q of rechazadas) assert.equal(mod.esConsultaSoloLectura(q), false, q)
})

test('la sesión RLS se inyecta con los claims del usuario autorizado, nunca del cliente', () => {
  const exec = leer('lib/mcp/sql-executor.ts')
  assert.match(exec, /request\.jwt\.claims/)
  assert.match(exec, /opts\.userId/)
  // role authenticated: es lo que las policies del repo esperan para auth.uid()/auth_tenant_ids.
  assert.match(exec, /role: 'authenticated'/)
})

test('OAuth: PKCE S256 obligatorio y códigos de un solo uso atómico', () => {
  const authorize = leer('app/api/mcp/oauth/authorize/route.ts')
  const oauth = leer('lib/mcp/oauth.ts')
  const store = leer('lib/mcp/store.ts')
  assert.match(oauth, /code_challenge_method !== 'S256'/)
  assert.match(oauth, /CODE_TTL_S = 60/)
  // Canje atómico: UPDATE condicionado a used_at nulo, no un SELECT ingenuo.
  assert.match(store, /\.is\('used_at', null\)/)
  assert.match(authorize, /emitirCodigo/)
})

test('OAuth: refresh con rotación (reutilizar revoca) y access revocable por jti', () => {
  const oauth = leer('lib/mcp/oauth.ts')
  const store = leer('lib/mcp/store.ts')
  assert.match(oauth, /ACCESS_TTL_S = 15 \* 60/)
  assert.match(oauth, /REFRESH_TTL_S = 30/)
  assert.match(store, /\.is\('revoked_at', null\)/)
  // El access token se valida contra BD para que revocar sea inmediato, no a los 15 min.
  assert.match(oauth, /findAccessToken/)
})

test('nada de credenciales en claro en la base de datos OAuth', () => {
  const migracion = leer('supabase/migrations/20261009160000_mcp_server_oauth_and_reader.sql')
  assert.match(migracion, /client_secret_hash/)
  assert.match(migracion, /code_hash/)
  assert.match(migracion, /refresh_hash/)
  assert.doesNotMatch(migracion, /client_secret TEXT/)
  assert.doesNotMatch(migracion, /\bcode TEXT\b/)
})

test('el rol lector no puede login ni escribir, y el RLS de las tablas OAuth existe', () => {
  const migracion = leer('supabase/migrations/20261009160000_mcp_server_oauth_and_reader.sql')
  assert.match(migracion, /CREATE ROLE mcp_reader NOLOGIN/)
  // Grants explícitos: SELECT nada más.
  assert.match(migracion, /GRANT SELECT ON TABLE public\.%I TO mcp_reader/)
  assert.doesNotMatch(migracion, /GRANT INSERT|GRANT UPDATE|GRANT DELETE/)
  for (const tabla of ['mcp_oauth_clients', 'mcp_oauth_codes', 'mcp_oauth_tokens']) {
    assert.match(migracion, new RegExp(`ALTER TABLE public\\.${tabla} ENABLE ROW LEVEL SECURITY`))
  }
  // El dueño (no service_role) es quien ve sus clientes: RLS por owner_user_id/user_id.
  assert.match(migracion, /owner_user_id = \(select auth\.uid\(\)\)/)
  assert.match(migracion, /user_id = \(select auth\.uid\(\)\)/)
})

test('el endpoint MCP no filtra datos sin token y degrada cerrado sin MCP_JWT_SECRET', () => {
  const route = leer('app/api/mcp/route.ts')
  assert.match(route, /Bearer /)
  assert.match(route, /status: 503/)
  assert.match(route, /status: 401/)
  // Una sola implementación canónica de la validación Bearer (revocación inmediata en BD).
  assert.match(route, /validarAccessToken/)
  assert.doesNotMatch(route, /findAccessToken|verifyJwt/)
})

test('el middleware deja pasar /api/mcp y .well-known sin cookie de sesión', () => {
  const mw = leer('middleware.ts')
  assert.match(mw, /'\/api\/mcp'/)
  assert.match(mw, /'\/\.well-known\/oauth-protected-resource'/)
  assert.match(mw, /'\/\.well-known\/oauth-authorization-server'/)
})

test('registro dinámico: redirect_uri https y consentimiento fija la propiedad', () => {
  const register = leer('app/api/mcp/oauth/register/route.ts')
  const authorize = leer('app/api/mcp/oauth/authorize/route.ts')
  assert.match(register, /https:/)
  assert.doesNotMatch(register, /http:\/\/(?!localhost)/) // sin http plano en las URIs aceptadas
  // La propiedad se asigna al aprobar: un client_id registrado por cualquiera no lee nada solo.
  assert.match(authorize, /asignarPropietario/)
  // Y el consentimiento exige sesión Supabase.
  assert.match(authorize, /sesionActual/)
})

test('pantalla de conexiones MCP: revocación acotada al dueño y estado calculado en servidor', () => {
  const store = leer('lib/mcp/store.ts')
  const api = leer('app/api/mcp/management/route.ts')
  const panel = leer('components/settings/McpConexionesPanel.tsx')

  // El listado filtra por owner_user_id; las sesiones salen de los clientes PROPIOS (join client→owner).
  assert.match(store, /listarClientesDeUsuario/)
  assert.match(store, /\.eq\('owner_user_id', userId\)/)

  // Revocar UNA sesión: UPDATE acotado por los client_ids propios y revoked_at nulo.
  const revocarSesion = store.slice(store.indexOf('export async function revocarSesion'))
  assert.match(revocarSesion, /\.in\('client_id', \[\.\.\.clientIds\]\)/)
  assert.match(revocarSesion, /\.is\('revoked_at', null\)/)

  // Revocar cliente: borra con owner_user_id en el filtro y verifica el borrado real (count).
  const revocarCliente = store.slice(store.indexOf('export async function revocarCliente'))
  assert.match(revocarCliente, /\.eq\('owner_user_id', userId\)/)
  assert.match(revocarCliente, /count: 'exact'/)

  // La API exige sesión (401 sin usuario) y revoca con el userId del SERVIDOR, nunca un id del cliente.
  assert.match(api, /userIdActual/)
  assert.match(api, /status: 401/)
  assert.match(api, /revocarSesion\(userId/)
  assert.match(api, /revocarCliente\(userId/)

  // El estado (activa/revocada/caducada) lo calcula el servidor, no el navegador.
  assert.match(api, /estadoSesion/)
  // Y la tarjeta existe en Configuración.
  const grid = leer('app/[tenant]/settings/page.tsx')
  assert.match(grid, /settings\/mcp/)
  assert.match(panel, /api\/mcp\/management/)
})
