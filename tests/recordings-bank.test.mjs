import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const ROUTE = 'app/api/[tenant]/evergreen/grabaciones/route.ts'
const PAGE = 'app/[tenant]/recursos/grabaciones/page.tsx'
const SQL = 'supabase/migrations/20260913150000_call_recordings.sql'

test('la categoría se decide por MIME y no con IA', () => {
  const lib = read('lib/recordings/categorize.ts')
  // Ni llamadas a un modelo, ni deducción por la extensión del nombre (se puede renombrar).
  assert.doesNotMatch(lib, /anthropic|claude|openai|gpt/i)
  assert.doesNotMatch(lib, /\.split\('\.'\)|extname|endsWith\('\.mp3'\)/)
  assert.match(read(ROUTE), /categorizeByMime\(body\.mimeType\)/)
})

test('el resultado de la llamada no puede venir de la IA', () => {
  const lib = read('lib/recordings/outcome.ts')
  assert.doesNotMatch(lib, /anthropic|claude|openai|gpt/i)
  // Solo mira hechos: ventas atadas, status de la cita y etapa de seguimiento.
  assert.match(lib, /ACTIVE_SALE_STATUSES/)
  assert.doesNotMatch(lib, /ai_summary|ai_call_score|ai_analysis|ai_lead_score/)
})

test('el endpoint valida la ruta contra el tenant de la sesión', () => {
  const route = read(ROUTE)
  // Sin esto se podría registrar un archivo colocado bajo la carpeta de otra subcuenta.
  assert.match(route, /storagePath\.startsWith\(`\$\{session\.tenantId\}\/`\)/)
  assert.match(route, /await requireTenant\(tenant\)/)
  assert.doesNotMatch(route, /searchParams\.get\('tenant'\)/)
})

test('el dedupe es por hash del contenido y no rompe el reintento', () => {
  const route = read(ROUTE)
  assert.match(route, /\^\[0-9a-f\]\{64\}\$/, 'no valida el formato del hash')
  assert.match(route, /duplicado: true/, 'un repetido debe responder 200, no un error a reintentar')
  assert.match(route, /'23505'/, 'no contempla la carrera que resuelve el índice único')
  assert.match(read(SQL), /CREATE UNIQUE INDEX call_recordings_tenant_sha_key[\s\S]*\(tenant_id, sha256\)/)
})

test('la aprobación es manual y comprueba que afectó a alguna fila', () => {
  const route = read(ROUTE)
  assert.match(route, /status: body\.status/)
  assert.match(route, /reviewed_by: session\.userId/)
  // 0 filas sin error = no era de esta subcuenta. No se reporta éxito.
  assert.match(route, /data\.length === 0/)
  // \s+ y no un espacio: las columnas del fichero están alineadas.
  assert.match(read(SQL), /status\s+TEXT NOT NULL DEFAULT 'pendiente'/)
  assert.match(read(SQL), /call_recordings_review_coherent/)
})

test('el bucket de grabaciones es privado y aislado por el prefijo de la ruta', () => {
  const sql = read(SQL)
  assert.match(sql, /VALUES \('grabaciones', 'grabaciones', false\)/)
  assert.match(sql, /DO UPDATE SET public = false/)
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] IN \(SELECT public\.auth_tenant_ids\(\)::text\)/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
})

test('la pantalla sube en serie, calcula el hash y permite reintentar sin reelegir el archivo', () => {
  const page = read(PAGE)
  assert.match(page, /crypto\.subtle\.digest\('SHA-256'/)
  // El File se conserva en el estado: reintentar no obliga a volver a seleccionarlo.
  assert.match(page, /file: File/)
  assert.match(page, /subirUno\(u, i\)/)
  // En serie: un for await, no un Promise.all que satura la conexión.
  assert.match(page, /for \(let i = 0; i < uploads\.length; i\+\+\)/)
  assert.doesNotMatch(page, /Promise\.all\(uploads/)
  // Los archivos se abren con enlace firmado de vida corta, nunca por URL pública.
  assert.match(page, /openSignedStorageFile\(BUCKET/)
  assert.doesNotMatch(page, /getPublicUrl/)
})
