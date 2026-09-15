import assert from 'node:assert/strict'
import test from 'node:test'
import { leerRolMembresia, resolverRol, ROLES_ELEVADOS, TOPE_SIN_ADMINISTRACION } from '../../lib/auth/rol-efectivo.ts'

const caso = (over = {}) => ({ rolGlobal: 'director', rolMembresia: 'member', esSuperAdmin: false, ...over })

// =============================================================================================
// EL AGUJERO, EN UN TEST. Rol funcional `director` (global) + acceso de `member` a la subcuenta de
// otro cliente = director de ese cliente. Esto es lo que deja de pasar.
// =============================================================================================

test('un rol de administración no se ejerce en una subcuenta donde solo eres miembro', () => {
  const r = resolverRol(caso({ rolGlobal: 'director', rolMembresia: 'member' }))
  assert.equal(r.rol, 'manager')
  assert.equal(r.administraTenant, false)
  assert.equal(r.recortado, true)
  assert.match(r.motivo, /subcuenta propia/)
  // El global queda visible para poder explicar el 403, pero no para decidir.
  assert.equal(r.rolGlobal, 'director')
})

test('lo mismo con admin, que es el otro rol que concede administración', () => {
  assert.equal(resolverRol(caso({ rolGlobal: 'admin' })).rol, 'manager')
  assert.deepEqual(ROLES_ELEVADOS, ['admin', 'director'])
})

// Y el tope solo se aplica a los elevados: un closer sigue siendo closer donde se le dé acceso, porque
// su rol no concede administración en ninguna subcuenta y no hay escalada que cerrar.
test('un rol no elevado no se toca', () => {
  for (const rol of ['closer', 'setter', 'marketing', 'cobros', 'gestoria', 'manager', 'csm', 'editor']) {
    const r = resolverRol(caso({ rolGlobal: rol }))
    assert.equal(r.rol, rol, rol)
    assert.equal(r.recortado, false, rol)
    assert.equal(r.motivo, null, rol)
  }
})

// =============================================================================================
// QUIEN SÍ ADMINISTRA NO SE TOCA. Si se recortara, el dueño se quedaría sin administrar lo suyo.
// =============================================================================================

test('con membresía de admin en esta subcuenta el rol se mantiene', () => {
  const r = resolverRol(caso({ rolGlobal: 'director', rolMembresia: 'admin' }))
  assert.equal(r.rol, 'director')
  assert.equal(r.administraTenant, true)
  assert.equal(r.recortado, false)
})

test('el super_admin de plataforma manda sobre todo, incluso sin fila de membresía', () => {
  const r = resolverRol({ rolGlobal: 'admin', rolMembresia: null, esSuperAdmin: true })
  assert.equal(r.rol, 'admin')
  assert.equal(r.administraTenant, true)
  assert.equal(r.recortado, false)
})

test('membresía super_admin también administra', () => {
  assert.equal(resolverRol(caso({ rolMembresia: 'super_admin' })).administraTenant, true)
})

// =============================================================================================
// BORDES
// =============================================================================================

// Sin fila de membresía y sin ser super_admin no se debería llegar aquí (requireTenant ya devuelve 403),
// pero si se llega, el tope tiene que aplicarse igual: fallar cerrando, no abriendo.
test('sin membresía y sin super_admin, un rol elevado también se recorta', () => {
  const r = resolverRol({ rolGlobal: 'admin', rolMembresia: null, esSuperAdmin: false })
  assert.equal(r.rol, TOPE_SIN_ADMINISTRACION)
  assert.equal(r.administraTenant, false)
})

test('sin rol funcional no hay nada que recortar y no se inventa uno', () => {
  const r = resolverRol({ rolGlobal: null, rolMembresia: 'member', esSuperAdmin: false })
  assert.equal(r.rol, null)
  assert.equal(r.recortado, false)
  // Y desde luego no se le regala 'manager' a quien no tiene rol.
  assert.notEqual(r.rol, 'manager')
})

// Un valor inesperado en la columna no puede colarse como si fuera un rol válido: 'administrador' o
// 'ADMIN' darían administración por parecido si se aceptaran tal cual.
test('un rol de membresía inesperado no cuenta como válido', () => {
  for (const raw of ['administrador', 'ADMIN', 'owner', '', null, undefined, 1, {}, ['admin']]) {
    assert.equal(leerRolMembresia(raw), null, String(raw))
  }
  for (const raw of ['admin', 'member', 'super_admin']) assert.equal(leerRolMembresia(raw), raw)
})

test('un rol de membresía no reconocido no concede administración', () => {
  const r = resolverRol({ rolGlobal: 'admin', rolMembresia: leerRolMembresia('owner'), esSuperAdmin: false })
  assert.equal(r.administraTenant, false)
  assert.equal(r.rol, 'manager')
})

test('el tope recortado siempre trae motivo, y el no recortado nunca', () => {
  assert.ok(resolverRol(caso()).motivo)
  assert.equal(resolverRol(caso({ rolMembresia: 'admin' })).motivo, null)
})
