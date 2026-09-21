import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EXCEPCIONES_SIN_TENANT,
  detectarViolacionesTenant,
  formatearViolaciones,
} from '../lib/seguridad/invariante-tenant.ts'
import { TENANT_A, TENANT_B, dosSubcuentasPobladas } from './fixtures/tenants-sinteticos.mjs'

// F-1 — EL INVARIANTE DE SUBCUENTA, Y LA PRUEBA DE QUE DETECTA.
//
// `esquema-tenant-invariante.test.mjs` ya comprobaba el invariante contra el esquema vivo, pero
// tenía dos huecos que F-1 exige cerrar:
//
//   1. Se auto-salta sin credenciales, así que en local nadie lo ejerce.
//   2. NADIE HABÍA DEMOSTRADO QUE FALLE CUANDO DEBE. Un detector que solo se ejecuta contra un
//      esquema que ya cumple está siempre en verde, incluso si dejara de detectar. Eso es el test
//      negativo que pide el prompt de la fase.
//
// Aquí el detector es una función pura (`lib/seguridad/invariante-tenant.ts`), así que se le puede
// dar un esquema roto a propósito. Y se ejerce además contra la instantánea real de producción, que
// corre siempre y sin credenciales.

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const ok = (tabla, extra = {}) => ({
  tabla,
  tieneTenantId: true,
  tenantIdNotNull: true,
  rlsHabilitada: true,
  politicas: 2,
  ...extra,
})

// ── EL DETECTOR DETECTA (tests negativos) ────────────────────────────────────────────────────

test('una tabla de subcuenta sin columna tenant_id se detecta', () => {
  const v = detectarViolacionesTenant([ok('ventas'), ok('fuga', { tieneTenantId: false, tenantIdNotNull: false })])
  assert.equal(v.length, 1)
  assert.equal(v[0].tabla, 'fuga')
  assert.match(v[0].motivo, /sin columna tenant_id/)
})

test('tenant_id nullable se detecta: una fila podría nacer huérfana', () => {
  const v = detectarViolacionesTenant([ok('fuga', { tenantIdNotNull: false })])
  assert.equal(v.length, 1)
  assert.match(v[0].motivo, /admite NULL/)
})

test('una tabla de subcuenta sin RLS se detecta', () => {
  const v = detectarViolacionesTenant([ok('fuga', { rlsHabilitada: false })])
  assert.equal(v.length, 1)
  assert.match(v[0].motivo, /sin RLS/)
})

test('RLS habilitada pero sin ninguna política se detecta', () => {
  // No es "abierta": es inusable salvo saltándose RLS, que es como se acaba usando service-role
  // donde no toca. Por eso cuenta como violación y no como configuración válida.
  const v = detectarViolacionesTenant([ok('fuga', { politicas: 0 })])
  assert.equal(v.length, 1)
  assert.match(v[0].motivo, /sin ninguna política/)
})

test('varias violaciones en la misma tabla se acumulan, no se pierden tras la primera', () => {
  const v = detectarViolacionesTenant([ok('fuga', { tenantIdNotNull: false, rlsHabilitada: false })])
  assert.equal(v.length, 2)
  assert.deepEqual(
    v.map((x) => x.tabla),
    ['fuga', 'fuga']
  )
})

test('un esquema correcto no produce falsos positivos', () => {
  assert.deepEqual(detectarViolacionesTenant([ok('ventas'), ok('cobros'), ok('contactos')]), [])
})

// ── LAS EXCEPCIONES SON EXCEPCIONES, NO UN AGUJERO ───────────────────────────────────────────

test('una tabla global declarada se salta entera', () => {
  assert.deepEqual(
    detectarViolacionesTenant([
      { tabla: 'roles', tieneTenantId: false, tenantIdNotNull: false, rlsHabilitada: false, politicas: 0 },
    ]),
    []
  )
})

test('la lista de excepciones es cerrada y cada una tiene motivo escrito', () => {
  assert.deepEqual(Object.keys(EXCEPCIONES_SIN_TENANT).sort(), [
    'resource_link_divisions',
    'resource_links',
    'roles',
    'tenants',
    'users',
  ])
  for (const [tabla, motivo] of Object.entries(EXCEPCIONES_SIN_TENANT)) {
    assert.ok(motivo.length > 20, `la excepción "${tabla}" necesita un motivo, no una etiqueta`)
  }
})

test('inventarse una excepción por el nombre no cuela', () => {
  // Protege contra el mismo fallo que tenía `autorizarTool`: mirar una tabla de excepciones con
  // acceso directo hace que `constructor` o `__proto__` parezcan declaradas.
  for (const tabla of ['__proto__', 'constructor', 'toString']) {
    const v = detectarViolacionesTenant([
      { tabla, tieneTenantId: false, tenantIdNotNull: false, rlsHabilitada: false, politicas: 0 },
    ])
    assert.equal(v.length, 1, `"${tabla}" no está declarada y debe violar el invariante`)
  }
})

// ── EL ESQUEMA REAL CUMPLE (corre siempre, sin credenciales) ─────────────────────────────────

test('la instantánea de producción cumple el invariante', () => {
  // Capturada de pg_class/pg_attribute/pg_policy el 2026-09-21. Mismo patrón que
  // `rls-acyclicity.test.mjs`: una instantánea versionada permite comprobar en CI sin credenciales
  // y deja el cambio a la vista en el diff cuando el esquema evoluciona.
  const snapshot = JSON.parse(readFileSync(join(root, 'tests/fixtures/esquema-produccion-20260921.json'), 'utf8'))
  assert.ok(snapshot.length >= 100, `instantánea inesperadamente pequeña (${snapshot.length} tablas)`)
  const violaciones = detectarViolacionesTenant(snapshot)
  assert.deepEqual(violaciones, [], `el esquema viola el invariante:\n${formatearViolaciones(violaciones)}`)
})

test('las excepciones declaradas coinciden con las tablas sin tenant_id de producción', () => {
  // Si producción gana una tabla sin tenant_id que nadie declaró, el test de arriba ya falla. Este
  // cubre el caso inverso: una excepción que sobra, que silenciaría una tabla que hoy sí cumple.
  const snapshot = JSON.parse(readFileSync(join(root, 'tests/fixtures/esquema-produccion-20260921.json'), 'utf8'))
  const sinTenantEnProduccion = snapshot
    .filter((t) => !t.tieneTenantId)
    .map((t) => t.tabla)
    .sort()
  assert.deepEqual(sinTenantEnProduccion, Object.keys(EXCEPCIONES_SIN_TENANT).sort())
})

// ── FIXTURES TENANT A Y B ────────────────────────────────────────────────────────────────────

test('los fixtures A y B son dos subcuentas distintas y deterministas', () => {
  assert.notEqual(TENANT_A.id, TENANT_B.id)
  assert.match(TENANT_A.id, /^[0-9a-f-]{36}$/)
  assert.match(TENANT_B.id, /^[0-9a-f-]{36}$/)
})

test('los fixtures no llevan datos reales: dominios y teléfonos reservados', () => {
  const { contacts } = dosSubcuentasPobladas()
  for (const c of contacts) {
    assert.match(c.email, /\.example\.test$/, 'example.test está reservado por RFC 2606: nunca resuelve')
    assert.match(c.phone, /^\+3490000/, 'rango +34 900 reservado para pruebas')
  }
})

test('filtrar por una subcuenta nunca devuelve filas de la otra', () => {
  // La comprobación obvia que una query sin acotar incumple en silencio. Con los fixtures, cualquier
  // prueba de aislamiento futura tiene un par A/B estable contra el que medirse.
  const datos = dosSubcuentasPobladas()
  for (const tabla of ['contacts', 'contact_notes']) {
    const deA = datos[tabla].filter((f) => f.tenant_id === TENANT_A.id)
    assert.ok(deA.length > 0, `el fixture debe poblar ${tabla} en A`)
    assert.equal(
      deA.some((f) => f.tenant_id === TENANT_B.id),
      false
    )
    assert.ok(
      datos[tabla].some((f) => f.tenant_id === TENANT_B.id),
      `el fixture debe poblar ${tabla} en B para que el contraste sirva`
    )
  }
})
