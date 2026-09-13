import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const ROUTE = 'app/api/[tenant]/evergreen/settings/subcuentas/route.ts'
const PROVISION = 'lib/tenants/provision.ts'
const BLUEPRINT = 'lib/tenants/blueprint.ts'

// El primer segmento de la URL ES la subcuenta, así que la lista de reservados tiene que cubrir TODO
// lo que hoy cuelga de la raíz de `app/`. Si mañana alguien añade `app/status/`, este test falla y
// obliga a reservar ese nombre — que es la única forma de que la lista no se quede obsoleta sola.
test('los reservados cubren todos los directorios de la raíz de app/', () => {
  const blueprint = read(BLUEPRINT)
  const reservados = [...blueprint.matchAll(/^ {2}'([a-z0-9-]+)',$/gm)].map((m) => m[1])
  assert.ok(reservados.length > 5, 'no se han extraído los slugs reservados')

  const enDisco = readdirSync(join(root, 'app'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('_'))
    .map((d) => d.name)
  assert.ok(enDisco.includes('api'), 'no se ha leído el árbol de app/')

  const sinReservar = enDisco.filter((name) => !reservados.includes(name))
  assert.deepEqual(sinReservar, [], `estas rutas de app/ no están reservadas como slug: ${sinReservar.join(', ')}`)
})

// Crear subcuentas es una operación de PLATAFORMA. Un admin de cliente que pudiera crearlas se daría
// acceso a sí mismo a una subcuenta nueva sin que nadie lo autorizara.
test('solo el super admin de plataforma puede listar y crear subcuentas', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /if \(!session\.isSuperAdmin\)/, 'la ruta no exige super admin')
  assert.match(route, /status: 403/)
  // El gate es compartido por GET y POST: dos comprobaciones distintas se desincronizan.
  assert.match(route, /requireSuperAdmin\(tenant\)/)
  const gets = [...route.matchAll(/requireSuperAdmin\(tenant\)/g)]
  assert.equal(gets.length, 2, 'GET y POST deberían pasar por el mismo gate')
  // El rol NO se lee del body ni de un query param.
  assert.doesNotMatch(route, /body\.(role|isSuperAdmin|superAdmin)/)
})

// La regla de la fase: una subcuenta nace configurada y VACÍA. Sembrar productos, planes o ventas de
// ejemplo metería filas inventadas en las tablas de las que salen la facturación y las comisiones.
test('el aprovisionador no siembra datos de ejemplo', () => {
  const provision = sinComentarios(read(PROVISION))
  const escrituras = [...provision.matchAll(/\.from\('([a-z_]+)'\)[\s\S]{0,120}?\.(insert|upsert|update)\(/g)].map(
    (m) => m[1]
  )
  assert.deepEqual(
    [...new Set(escrituras)].sort(),
    ['audit_logs', 'tenant_members', 'tenants'],
    'el aprovisionador escribe en tablas que no debería tocar'
  )
  for (const prohibida of ['products', 'payment_plans', 'sales', 'contacts', 'appointments']) {
    assert.doesNotMatch(provision, new RegExp(`from\\('${prohibida}'\\)[\\s\\S]{0,120}?\\.(insert|upsert)`))
  }
})

// Un `upsert` por slug reescribiría la marca de un cliente en producción porque alguien repitió un
// nombre en un formulario.
test('un slug ya usado se rechaza en vez de sobreescribir la subcuenta existente', () => {
  const provision = sinComentarios(read(PROVISION))
  assert.match(provision, /slug_ocupado/)
  assert.doesNotMatch(provision, /from\('tenants'\)[\s\S]{0,120}?\.upsert\(/, 'nunca un upsert sobre tenants')
  assert.match(provision, /\.eq\('slug', input\.slug\)/, 'no se comprueba si el slug ya existe')
})

// Supabase no da error cuando un INSERT afecta a 0 filas: sin comprobarlo diríamos "creada" sin haber
// creado nada, o "tienes acceso" sin haberlo dado.
test('cada escritura comprueba las filas escritas', () => {
  const provision = sinComentarios(read(PROVISION))
  assert.match(provision, /created\.data\.length === 0/)
  assert.match(provision, /member\.data\.length === 0/)
  assert.match(provision, /no_escrito/)
  assert.match(provision, /sin_acceso/)
})

// Si la subcuenta se crea pero el acceso falla, decirlo a medias deja al operador sin saber por qué
// no la ve, y repetir la creación le dirá "slug ocupado".
test('un aprovisionamiento a medias se reporta con el id delante', () => {
  const provision = read(PROVISION)
  const bloque = provision.slice(provision.indexOf('sin_acceso'))
  assert.match(bloque, /tenant\.id/, 'el error de acceso no dice el id de la subcuenta creada')
  assert.match(bloque, /tenant_members/, 'no se dice dónde añadirse a mano')
})

// Contar mal no es contar 0: una subcuenta con productos que salga con "0 productos" porque falló la
// lectura haría que alguien los creara otra vez.
test('un fallo al contar no se convierte en un cero', () => {
  const provision = read(PROVISION)
  assert.match(provision, /if \(tableError\) continue/)
  assert.match(sinComentarios(provision), /limit\(20_000\)/, 'sin límite explícito PostgREST trunca en silencio')
})

test('la tarjeta de Subcuentas solo se pinta para super admin', () => {
  const page = read('app/[tenant]/settings/page.tsx')
  assert.match(page, /superAdminOnly: true/)
  assert.match(page, /sb\.rpc\('is_super_admin'\)/, 'super admin no es un rol de users: hay que preguntar a la función')
  assert.match(page, /superAdminOnly\) return isSuperAdmin === true/)
  // Arranca en null para no pintar la tarjeta antes de saberlo.
  assert.match(page, /useState<boolean \| null>\(null\)/)
})
