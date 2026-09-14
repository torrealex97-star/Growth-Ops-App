import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

const WEBHOOKS = [
  'app/api/[tenant]/evergreen/webhooks/calendly/route.ts',
  'app/api/[tenant]/evergreen/webhooks/ghl/route.ts',
]
const MIGRACION = 'supabase/migrations/20260914150000_contacts_get_or_create.sql'

// Dos entregas concurrentes del mismo lead (Calendly reintentando, o Calendly y GHL notificando el
// mismo optin) pasaban las dos por el SELECT en vacío y creaban DOS contactos: citas en uno, venta
// en el otro, y los embudos contando dos personas donde hay una.
test('ningún webhook crea contactos con check-then-insert', () => {
  for (const p of WEBHOOKS) {
    const route = read(p)
    assert.ok(!/from\('contacts'\)\s*\n?\s*\.insert\(/.test(route), `${p} sigue insertando contactos a mano`)
    assert.match(route, /getOrCreateContact\(sb, tenantId, \{/, `${p} debe resolver por la función de BD`)
    assert.match(route, /from '@\/lib\/contacts\/resolve'/)
  }
})

test('el resolutor delega en la función de base de datos, sin lógica de encaje duplicada', () => {
  const lib = read('lib/contacts/resolve.ts')
  assert.match(lib, /\.rpc\('contacts_get_or_create'/)
  // Nada de SELECT/INSERT en el helper: si la resolución volviera a TypeScript, volvería la carrera.
  for (const escritura of ["from('contacts')", '.insert(', '.upsert(']) {
    assert.ok(!lib.includes(escritura), `el helper no debe tocar la tabla directamente: ${escritura}`)
  }
  assert.match(lib, /p_tenant_id: tenantId/)
})

test('la función serializa por clave de identidad y respeta la subcuenta', () => {
  const sql = read(MIGRACION)
  // Advisory lock por clave (no por tabla): dos leads distintos no se estorban.
  assert.match(sql, /pg_advisory_xact_lock/)
  for (const clave of [":e:' \\|\\| v_email", ":p:' \\|\\| v_phone", ":g:' \\|\\| v_ghl"]) {
    assert.match(sql, new RegExp(clave), `falta el lock de la clave ${clave}`)
  }
  // Los tres locks van con la subcuenta dentro de la clave: nunca se serializa entre subcuentas.
  const locks = sql.match(/pg_advisory_xact_lock\([^\n]*\)/g) ?? []
  assert.equal(locks.length, 3)
  for (const l of locks) assert.match(l, /p_tenant_id::text/)
  // Y todas las búsquedas filtran por subcuenta.
  const selects = sql.match(/FROM public\.contacts c\n\s*WHERE[^;]*/g) ?? []
  assert.ok(selects.length >= 3, 'se esperaban las tres búsquedas de encaje')
  for (const s of selects) assert.match(s, /tenant_id = p_tenant_id/)
})

test('la función no añade constraints: el UNIQUE de email va en su propia migración', () => {
  const sql = read(MIGRACION)
  // Ya hay duplicados históricos (existe la pantalla de fusión): un UNIQUE fallaría al crearse y
  // además rechazaría escrituras legítimas en vez de unificarlas.
  // Se comprueba sobre el SQL ejecutable: los comentarios sí explican por qué no se pone.
  const ejecutable = sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  assert.ok(!/UNIQUE/i.test(ejecutable), 'la migración no debe crear constraints UNIQUE sobre contacts')
  assert.ok(!/ALTER TABLE public\.contacts/i.test(ejecutable), 'la migración no debe alterar la tabla')
})

test('la función no es SECURITY DEFINER y solo la ejecuta service_role', () => {
  const sql = read(MIGRACION)
  assert.ok(!/SECURITY DEFINER/i.test(sql), 'SECURITY DEFINER daría un puente entre subcuentas')
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.contacts_get_or_create/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.contacts_get_or_create[\s\S]*?TO service_role;/)
  assert.match(sql, /SET search_path = public/)
})

test('una coincidencia ya fusionada resuelve al contacto primario', () => {
  const sql = read(MIGRACION)
  // Si no, una cita nueva de un lead fusionado aterriza en el duplicado muerto y vuelve a partir
  // el historial justo después de haberlo unificado.
  assert.match(sql, /merged_into INTO v_merged/)
  // Con tope de saltos, para no colgarse si una fusión dejó un ciclo.
  assert.match(sql, /v_hops >= 10/)
})
