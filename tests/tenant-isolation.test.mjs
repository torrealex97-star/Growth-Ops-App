import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

const CRON_DIR = 'app/api/[tenant]/evergreen/cron'
const cronRoutes = readdirSync(join(root, CRON_DIR), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `${CRON_DIR}/${e.name}/route.ts`)
  .filter((p) => existsSync(join(root, p)))

// Invariante raíz del incidente P0: una sesión NUNCA debe poder disparar un barrido global con
// service_role. El barrido de todas las subcuentas solo se autoriza con CRON_SECRET.
test('ningún cron autoriza por sesión un barrido de todas las subcuentas', () => {
  assert.ok(cronRoutes.length >= 10, 'no se han encontrado las rutas de cron')

  for (const route of cronRoutes) {
    const source = read(route)

    // Un handler que recorre tenants es "global" si lee la tabla `tenants` para iterar.
    const sweeps = /from\('tenants'\)[\s\S]{0,200}status', 'active'/.test(source)
    if (!sweeps) continue

    // En una ruta con barrido global, cualquier ruta de autorización por cookie de sesión que
    // NO acote el alcance con requireTenant es la vulnerabilidad que corregimos.
    const readsSessionCookie = /next\/headers|createServerClient/.test(source)
    if (readsSessionCookie) {
      assert.match(
        source,
        /requireTenant\(/,
        `${route} autoriza por sesión y hace barrido global sin acotar con requireTenant`
      )
    }
  }
})

// Las dos rutas con disparo manual desde la UI que se reescribieron en el fix P0.1/P0.2:
// GET = solo secreto, POST = solo la subcuenta de la URL.
const SPLIT_ROUTES = [
  `${CRON_DIR}/analyze-calls/route.ts`,
  `${CRON_DIR}/ai-insights/route.ts`,
  `${CRON_DIR}/monthly/route.ts`,
]

test('GET de los crons con disparo manual se autentica solo con CRON_SECRET', () => {
  for (const route of SPLIT_ROUTES) {
    const get = read(route).split('export async function GET')[1]
    assert.ok(get, `${route} no expone GET`)
    const body = get.split('export async function POST')[0]
    assert.match(body, /CRON_SECRET/, `${route}: GET no comprueba CRON_SECRET`)
    assert.doesNotMatch(body, /requireTenant\(/, `${route}: GET acepta sesión y no debe`)
  }
})

test('POST de los crons manuales saca el tenant de la URL, no del body, y no cruza subcuentas', () => {
  for (const route of SPLIT_ROUTES) {
    const source = read(route)
    const post = source.slice(source.indexOf('export async function POST'))
    assert.ok(post.startsWith('export async function POST'), `${route} no expone POST`)

    // El tenant sale de params + requireTenant.
    assert.match(post, /params: Promise<\{ tenant: string \}>/, `${route}: POST no recibe el tenant por la URL`)
    assert.match(post, /await requireTenant\(tenant\)/, `${route}: POST no valida con requireTenant`)
    assert.match(post, /session\.role !== 'admin'/, `${route}: POST no exige rol admin/director`)

    // Nunca del body, y nunca recorriendo tenants.
    assert.doesNotMatch(post, /req\.json\(\)|request\.json\(\)/, `${route}: POST lee el body`)
    assert.doesNotMatch(post, /from\('tenants'\)/, `${route}: POST consulta la tabla tenants`)

    // El trabajo real se hace con el tenantId de la sesión, no con una lista.
    assert.match(post, /session\.tenantId/, `${route}: POST no usa session.tenantId`)
  }
})

// P0.3: el DDL por HTTP se eliminó y no debe volver por la puerta de atrás.
test('no existe ninguna ruta que ejecute DDL por HTTP', () => {
  assert.equal(
    existsSync(join(root, 'app/api/[tenant]/evergreen/admin/setup/route.ts')),
    false,
    'la ruta /admin/setup ha vuelto'
  )
  assert.doesNotMatch(read('middleware.ts'), /admin\/setup['"]/, 'el middleware vuelve a exponer /admin/setup')
})

// P0.3: Storage privado y rutas prefijadas por tenant.
test('las políticas de Storage aíslan por tenant y dejan los buckets privados', () => {
  const sql = read('supabase/migrations/20260913100000_storage_tenant_policies.sql')
  assert.match(sql, /public = false/, 'la migración no fuerza los buckets a privados')
  assert.match(
    sql,
    /\(storage\.foldername\(name\)\)\[1\] IN \(SELECT public\.auth_tenant_ids\(\)::text\)/,
    'las políticas no acotan por el primer segmento = tenant_id'
  )
  for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.match(sql, new RegExp(`FOR ${op}`), `falta la política de ${op}`)
  }
})

test('los ficheros privados se sirven con signed URLs cortas', () => {
  const helper = read('lib/storage/signed-url.ts')
  const ttl = helper.match(/DEFAULT_TTL_SECONDS = (\d+)/)
  assert.ok(ttl, 'el helper no declara un TTL por defecto')
  assert.ok(Number(ttl[1]) <= 300, `TTL por defecto demasiado largo: ${ttl[1]}s`)
})

// P1.4: el reparto de beneficios no puede pasar del 100% ni "guardar" en silencio sin permisos.
test('el límite del 100% de socios se aplica en base de datos, no solo en la UI', () => {
  const sql = read('supabase/migrations/20260913110000_partners_profit_guard.sql')
  assert.match(sql, /pg_advisory_xact_lock/, 'sin lock, dos escrituras concurrentes pueden pasar del 100%')
  assert.match(sql, /v_total > 100/, 'no se comprueba el tope de 100')
  assert.match(sql, /RAISE EXCEPTION/, 'el trigger no aborta la escritura')
})

test('la UI de socios no reporta éxito cuando RLS bloquea la escritura', () => {
  const page = read('app/[tenant]/settings/socios/page.tsx')
  // Un UPDATE/DELETE bloqueado por RLS afecta a 0 filas SIN error: hay que pedir las filas.
  assert.match(page, /\.select\('id'\)/, 'las escrituras no piden las filas afectadas')
  assert.match(page, /length === 0/, 'no se comprueba que la escritura afectase a alguna fila')
  assert.match(page, /canWrite/, 'no hay puerta de rol en la UI')
})

// Los slugs de tablas con tenant_id deben ser únicos POR SUBCUENTA. Un unique global hace que la
// segunda subcuenta choque con una fila de otra que no puede ni ver por RLS, y bloquea el
// aprovisionamiento de subcuentas nuevas (todas chocarían en los slugs naturales).
test('ninguna tabla con tenant_id declara un unique global sobre slug', () => {
  const sql = read('supabase/migrations/20260913140000_tenant_scoped_slug_uniques.sql')
  for (const tabla of ['testimonios', 'qualification_questions', 'vsl_videos']) {
    assert.match(sql, new RegExp(`DROP INDEX IF EXISTS public\\.${tabla}_slug_key`), `${tabla}: no se quita el global`)
    assert.match(
      sql,
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${tabla}_tenant_slug_key[\\s\\S]*?\\(tenant_id, slug\\)`),
      `${tabla}: no se crea el único por subcuenta`
    )
  }
})

// El auto-registro de preguntas de cualificación falló EN SILENCIO desde la migración multi-tenant:
// el upsert no pasaba tenant_id (NOT NULL) y nadie miraba el error, así que la tabla quedó vacía
// habiendo pasado cientos de formularios.
test('los webhooks estampan tenant_id al registrar preguntas y no se tragan el error', () => {
  for (const route of [
    'app/api/[tenant]/evergreen/webhooks/calendly/route.ts',
    'app/api/[tenant]/evergreen/webhooks/ghl/route.ts',
  ]) {
    const source = read(route)
    const upsert = source.slice(source.indexOf("from('qualification_questions')"))
    assert.match(upsert.slice(0, 400), /tenant_id: tenantId/, `${route}: el upsert no estampa tenant_id`)
    assert.match(upsert.slice(0, 400), /onConflict: 'tenant_id,slug'/, `${route}: el conflicto sigue siendo global`)
    assert.doesNotMatch(source, /onConflict: 'slug'/, `${route}: queda un onConflict global`)
    assert.match(upsert.slice(0, 900), /qqError/, `${route}: el error del upsert se sigue tragando`)
  }
})

// Este test existe por un fallo que costó meses de datos perdidos: seis rutas de cron existían y
// NINGUNA tenía planificador. Ni en vercel.json ni en pg_cron (que no está instalada). No fallaban:
// simplemente nunca se ejecutaban, y "Meta no sincroniza" parecía un problema de credenciales.
test('toda ruta de cron con GET está declarada en el catálogo de sincronizaciones', () => {
  const dir = join(root, 'app/[tenant]/evergreen'.replace('[tenant]/evergreen', 'api/[tenant]/evergreen/cron'))
  const rutas = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      const file = join(dir, name, 'route.ts')
      return existsSync(file) && readFileSync(file, 'utf8').includes('export async function GET')
    })

  const catalogo = read('lib/ops/sync-health.ts')
  const sinDeclarar = rutas.filter((name) => !catalogo.includes(`route: 'cron/${name}'`))
  assert.deepEqual(
    sinDeclarar,
    [],
    `estas rutas de cron no dicen quién las dispara: ${sinDeclarar.join(', ')}. ` +
      'Añádelas a SYNC_DEFS con su scheduler (y si es manual, con su motivo).'
  )
})
