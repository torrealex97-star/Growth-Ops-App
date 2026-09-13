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
  // El gate es UNO y lo usan todos los handlers: dos comprobaciones distintas se desincronizan, y un
  // handler nuevo sin gate deja la plataforma abierta a cualquier admin de subcuenta. Se cuenta
  // contra los handlers reales del fichero para que añadir uno sin gate rompa este test.
  const handlers = [...route.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)]
  const gates = [...route.matchAll(/requireSuperAdmin\(tenant\)/g)]
  assert.ok(handlers.length >= 3, 'no se han encontrado los handlers de la ruta')
  assert.equal(gates.length, handlers.length, `hay ${handlers.length} handlers y ${gates.length} gates`)
  // El privilegio nunca viene del cliente. `body.role` sí existe (es el rol que se da a otra
  // persona), pero solo puede llegar a la escritura pasando por validateMemberRole.
  assert.doesNotMatch(route, /body\.(isSuperAdmin|superAdmin|isAdmin)/)
  const usosDeRole = [...route.matchAll(/body\.role/g)]
  assert.equal(usosDeRole.length, 1, 'body.role debería usarse una sola vez, al validarlo')
  assert.match(route, /validateMemberRole\(body\.role\)/)
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

// ── Acceso y suspensión de subcuentas ───────────────────────────────────────
// El fallo que esto impide: `public.is_super_admin()` comprueba si existe ALGUNA fila de
// tenant_members con role='super_admin' para ese usuario, SIN filtrar por subcuenta. Así que ofrecer
// ese rol al añadir a alguien a una subcuenta lo convertiría en super admin de TODA la plataforma,
// con acceso a las demás — una escalada de privilegios con aspecto de permiso local.
test('el rol super_admin no se puede dar desde la pantalla de subcuentas', () => {
  const blueprint = read(BLUEPRINT)
  assert.match(blueprint, /ASSIGNABLE_MEMBER_ROLES = \['admin', 'member'\]/)
  assert.match(blueprint, /raw === 'super_admin'/, 'no se rechaza explícitamente el rol de plataforma')
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /validateMemberRole\(body\.role\)/, 'el rol no se valida antes de escribirlo')
  // El rol NO se puede colar tal cual desde el body a la escritura.
  const provision = sinComentarios(read(PROVISION))
  assert.doesNotMatch(provision, /role: 'super_admin'[\s\S]{0,80}grantAccess/)
  // La pantalla pinta solo los roles que el servidor declara asignables, no una lista propia.
  const page = read('app/[tenant]/settings/subcuentas/page.tsx')
  assert.match(page, /data\.assignableRoles\.map/)
  assert.doesNotMatch(sinComentarios(page), /'super_admin'\]/, 'la pantalla tiene su propia lista de roles')
})

// Dos formas de quedarse fuera sin arreglo posible desde la aplicación: quitarte tu propio acceso, y
// suspender la subcuenta desde la que estás administrando.
test('no se puede provocar un bloqueo del que no se pueda salir', () => {
  const provision = sinComentarios(read(PROVISION))
  assert.match(provision, /userId === actor\.userId/, 'se puede quitar el acceso a uno mismo')
  assert.match(provision, /no_a_ti_mismo/)
  assert.match(provision, /tenantId === actor\.tenantId/, 'se puede suspender la subcuenta propia')
  assert.match(provision, /no_la_propia/)
  // Y una subcuenta no puede quedarse sin ningún miembro: nadie podría administrarla después.
  assert.match(provision, /ultimo_miembro/)
  assert.match(provision, /members \?\? \[\]\)\.length <= 1/)
})

test('dar acceso no crea cuentas: si el email no existe, se dice', () => {
  const provision = sinComentarios(read(PROVISION))
  assert.match(provision, /usuario_inexistente/)
  // Crear un usuario implica alta en Auth y correo de invitación; hacerlo a medias dejaría cuentas
  // que no pueden entrar.
  assert.doesNotMatch(provision, /auth\.admin|createUser/)
  // Volver a añadir a alguien que ya está actualiza su rol en vez de fallar con clave duplicada.
  assert.match(provision, /onConflict: 'tenant_id,user_id'/)
})

test('las operaciones sobre subcuentas existentes pasan por el mismo gate y quedan auditadas', () => {
  const route = sinComentarios(read(ROUTE))
  const patch = route.slice(route.indexOf('export async function PATCH'))
  assert.match(patch, /requireSuperAdmin\(tenant\)/, 'el PATCH no pasa por el gate de super admin')
  const provision = sinComentarios(read(PROVISION))
  // Cada operación deja rastro: sin auditoría, un acceso dado o una suspensión no tiene autor.
  const audits = [...provision.matchAll(/from\('audit_logs'\)\.insert/g)]
  assert.ok(audits.length >= 4, `solo ${audits.length} operaciones auditadas: faltan acceso, revocación o estado`)
  assert.match(provision, /entity_type: 'tenant_member'/)
})
