import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// La lógica es pura, así que se prueba entera. El import dinámico evita el loader de TS del runner
// principal: este fichero solo lee ficheros, y la lógica llega por el test:metrics. Aquí se comprueba
// que el CABLEADO está puesto, que es lo que no se puede probar sin base de datos.

const REQUIRE_TENANT = 'lib/auth/requireTenant.ts'

// ---------------------------------------------------------------------------------------------
// LA ESCALADA QUE SE CIERRA: dos ejes de rol y solo uno estaba acotado por subcuenta.
// Alguien con rol funcional `director` (global), invitado a la subcuenta de otro cliente como simple
// `member`, entraba como director de ese cliente: podía escribir sus ventas, cobros y contratos.
// ---------------------------------------------------------------------------------------------

test('requireTenant lee el rol de tenencia de ESTA subcuenta, no solo la membresía', () => {
  const codigo = sinComentarios(leer(REQUIRE_TENANT))
  // Antes seleccionaba solo `id`: la existencia de la fila, sin mirar qué rol daba.
  assert.match(codigo, /\.select\('id, role'\)/)
  assert.match(codigo, /\.eq\('tenant_id', tenant\.id\)/)
  assert.match(codigo, /leerRolMembresia\(/)
})

test('el rol que se devuelve es el acotado, y el global queda aparte para diagnóstico', () => {
  const codigo = sinComentarios(leer(REQUIRE_TENANT))
  assert.match(codigo, /const resuelto = resolverRol\(\{ rolGlobal, rolMembresia, esSuperAdmin: isSuperAdmin \}\)/)
  assert.match(codigo, /role: resuelto\.rol/)
  assert.match(codigo, /rolGlobal: resuelto\.rolGlobal/)
  assert.match(codigo, /administraTenant: resuelto\.administraTenant/)
  // Lo importante: `role` ya NO es el valor crudo de users.roles.key.
  assert.doesNotMatch(codigo, /role: \(callerRow\?\.roles as/)
})

// Recortar el rol (en vez de añadir una bandera que hay que acordarse de comprobar) hace que las rutas
// que ya gatean por rol se aprieten solas. Esta es la propiedad que se quiere conservar.
test('las rutas siguen decidiendo con auth.role, que ahora llega acotado', () => {
  const rutas = [
    'app/api/[tenant]/evergreen/admin/backfill-stripe-sales/route.ts',
    'app/api/[tenant]/evergreen/fathom-revision/reintentar/route.ts',
    'app/api/[tenant]/evergreen/ai/contexto/route.ts',
  ]
  for (const r of rutas) {
    const src = sinComentarios(leer(r))
    assert.match(src, /auth\.role/, `${r} debería seguir gateando por auth.role`)
  }
})

test('el tope no puede dejar a nadie sin rol: sería convertir una corrección en una avería', () => {
  const src = leer('lib/auth/rol-efectivo.ts')
  assert.match(src, /export const TOPE_SIN_ADMINISTRACION: AppRole = 'manager'/)
  // 'manager' existe de verdad en el modelo de roles y NO pasa is_admin_or_director().
  assert.match(leer('lib/auth/permissions.ts'), /\| 'manager'/)
})

// El super_admin de plataforma sostiene el conmutador de subcuentas y el soporte: si se le recortara,
// el dueño se quedaría sin administrar sus propias subcuentas.
test('el super_admin de plataforma nunca se recorta', () => {
  const src = sinComentarios(leer('lib/auth/rol-efectivo.ts'))
  assert.match(
    src,
    /const administraTenant = e\.esSuperAdmin \|\| e\.rolMembresia === 'admin' \|\| e\.rolMembresia === 'super_admin'/
  )
  assert.match(src, /if \(administraTenant\) \{[\s\S]{0,200}recortado: false/)
})

// Quien crea una subcuenta recibe 'super_admin', así que el dueño no queda afectado por el tope.
test('el aprovisionamiento sigue dando super_admin a quien crea la subcuenta', () => {
  assert.match(leer('lib/tenants/provision.ts'), /role: 'super_admin'/)
})

// Y 'super_admin' sigue sin poder darse desde la pantalla de subcuentas: sería escalada a plataforma.
test('super_admin no es asignable desde la UI de subcuentas', () => {
  const src = leer('lib/tenants/blueprint.ts')
  assert.match(src, /ASSIGNABLE_MEMBER_ROLES = \['admin', 'member'\]/)
  assert.match(src, /raw === 'super_admin'/)
})

// ---------------------------------------------------------------------------------------------
// LA MITAD DE BASE DE DATOS. La mitad de aplicación cubre las ~118 rutas con service_role (donde RLS
// no interviene); esta cubre las escrituras directas desde el navegador con la sesión del usuario, que
// existen hoy en `expenses` y `contracts`.
// ---------------------------------------------------------------------------------------------

const MIGRACION = 'supabase/migrations/20260915130000_rol_acotado_por_subcuenta.sql'

test('el guardián es RESTRICTIVE, así que solo puede quitar permiso, nunca darlo', () => {
  const sql = leer(MIGRACION)
  assert.match(sql, /as restrictive for insert/)
  assert.match(sql, /as restrictive for update/)
  assert.match(sql, /as restrictive for delete/)
  // Ninguna política permisiva: una permisiva SÍ podría ampliar acceso.
  assert.doesNotMatch(sql, /create policy[^;]*as permissive/i)
})

// No se toca la lectura a propósito: decidir si un `member` ve las finanzas es producto, no seguridad.
test('el guardián no restringe SELECT', () => {
  const sql = leer(MIGRACION)
  assert.doesNotMatch(sql, /restrictive for select/i)
  assert.doesNotMatch(sql, /restrictive for all/i)
})

test('deniega exactamente el caso de escalada: las tres condiciones a la vez', () => {
  const sql = leer(MIGRACION)
  const fn = sql.slice(
    sql.indexOf('create or replace function public.rol_recortado_en'),
    sql.indexOf('create or replace function public.rol_en_tenant')
  )
  assert.match(fn, /public\.get_my_role\(\) in \('admin', 'director'\)/)
  assert.match(fn, /and not public\.is_super_admin\(\)/)
  assert.match(fn, /and not exists \(/)
  assert.match(fn, /role in \('admin', 'super_admin'\)/)
  // Y con el tenant de la FILA, no un tenant que elija quien llama.
  assert.match(fn, /tenant_id = check_tenant_id/)
})

test('las funciones nuevas llevan search_path fijo y no las puede ejecutar anon', () => {
  const sql = leer(MIGRACION)
  assert.equal((sql.match(/set search_path = public/g) || []).length, 2)
  assert.match(sql, /revoke execute on function public\.rol_recortado_en\(uuid\) from public, anon/)
  assert.match(sql, /revoke execute on function public\.rol_en_tenant\(uuid\) from public, anon/)
  assert.match(sql, /grant execute on function public\.rol_recortado_en\(uuid\) to authenticated/)
})

test('el tope de base dice lo mismo que el de aplicación', () => {
  const sql = leer(MIGRACION)
  // Mismos roles elevados y mismo tope: si los dos lados discreparan, habría dos verdades.
  assert.match(sql, /then 'manager'/)
  const ts = leer('lib/auth/rol-efectivo.ts')
  assert.match(ts, /ROLES_ELEVADOS: AppRole\[\] = \['admin', 'director'\]/)
  assert.match(ts, /TOPE_SIN_ADMINISTRACION: AppRole = 'manager'/)
})

test('cubre las tablas con escritura directa desde el navegador', () => {
  const sql = leer(MIGRACION)
  // `expenses` (finanzas/gastos-facturas/gastos) y `contracts` (contratos) escriben con la sesión del
  // usuario: ahí RLS es la única barrera.
  for (const t of ['expenses', 'contracts', 'sales', 'collections', 'refunds', 'commissions']) {
    assert.ok(sql.includes(`'${t}'`), t)
  }
})

test('las funciones son STABLE: se llaman por fila dentro de la política', () => {
  const sql = leer(MIGRACION)
  assert.equal((sql.match(/^stable$/gm) || []).length, 2)
})
