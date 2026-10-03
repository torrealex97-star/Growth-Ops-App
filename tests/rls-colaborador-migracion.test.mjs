import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// F01 (P0) — EL COLABORADOR NO LEE LOS DATOS DEL EQUIPO.
//
// Medido en producción: un colaborador con 0 ventas y 0 contactos propios veía 36/36 ventas,
// 636/636 citas, 686/688 contactos, 62/62 cobros y 82/82 pagos de Stripe, porque `users.data_scope`
// tiene DEFAULT 'team' y las políticas confían en ese valor. Este test fija la FORMA de la
// migración (no puede ejecutarla: la prueba real es `scripts/verificar-rls-colaborador.sql`).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const FICHERO = 'supabase/migrations/20261003100000_colaborador_no_lee_el_equipo.sql'
const sql = readFileSync(join(root, FICHERO), 'utf8')
// Sin comentarios: las cabeceras hablan de `team` y de lo que NO se toca, y no son SQL.
const codigo = sql.replace(/--[^\n]*/g, '')

const POLITICAS = [
  ['sales', 'sales_select_scope'],
  ['appointments', 'appointments_select_scope'],
  ['contacts', 'contacts_select_scope'],
  ['collections', 'collections_select_scope'],
  ['contact_attributions', 'contact_attributions_select_scope'],
  ['activities', 'activities_select'],
  ['stripe_payments', 'stripe_payments_select_team'],
  ['stripe_customers', 'stripe_customers_select_team'],
]

test('reescribe exactamente las ocho políticas que daban acceso al equipo', () => {
  const alteradas = [...codigo.matchAll(/ALTER POLICY (\w+) ON public\.(\w+)/g)].map((m) => [m[2], m[1]])
  assert.deepEqual(alteradas.sort(), [...POLITICAS].sort())
})

test('ninguna política conserva el atajo `team` sin excluir al colaborador', () => {
  // El fallo era justo ese atajo. Si alguien lo deja pelado en una de las ocho, vuelve la fuga.
  const bloques = codigo.split(/ALTER POLICY/).slice(1)
  assert.equal(bloques.length, POLITICAS.length)
  for (const b of bloques) {
    const nombre = b.trim().split(/\s/)[0]
    for (const t of b.matchAll(/my_data_scope\(\)\s*=\s*'team'/g)) {
      const resto = b.slice(t.index, t.index + 120)
      assert.match(
        resto,
        /AND NOT \(SELECT public\.soy_colaborador\(\)\)/,
        `${nombre}: atajo team sin excluir al colaborador`
      )
    }
  }
})

test('Stripe sigue abierto a admin/director y super admin, y cerrado al colaborador', () => {
  for (const nombre of ['stripe_payments_select_team', 'stripe_customers_select_team']) {
    const b = codigo.split(`ALTER POLICY ${nombre}`)[1].split(/ALTER POLICY|COMMIT/)[0]
    assert.match(b, /is_super_admin\(\)/)
    assert.match(b, /is_admin_or_director\(\)/)
    assert.match(b, /AND NOT \(SELECT public\.soy_colaborador\(\)\)/)
  }
})

test('la función es SECURITY DEFINER, fija su search_path y no la ejecuta anon', () => {
  assert.match(codigo, /CREATE OR REPLACE FUNCTION public\.soy_colaborador\(\)/)
  assert.match(codigo, /SECURITY DEFINER/)
  assert.match(codigo, /SET search_path TO 'public'/)
  assert.match(codigo, /REVOKE EXECUTE ON FUNCTION public\.soy_colaborador\(\) FROM PUBLIC, anon/)
  assert.match(codigo, /GRANT EXECUTE ON FUNCTION public\.soy_colaborador\(\) TO authenticated, service_role/)
})

test('"colaborador" es tener perfil en CUALQUIER estado, no solo `active`', () => {
  // La capa de app trata «no activo» como «no colaborador» (resolverScopeColaborador → none), así
  // que el intervalo en que alguien ya tiene login pero no ha firmado solo lo cubre el RLS.
  const cuerpo = codigo.split('CREATE OR REPLACE FUNCTION public.soy_colaborador()')[1].split('$$;')[0]
  assert.match(cuerpo, /collaborator_profiles/)
  assert.match(cuerpo, /cp\.user_id = auth\.uid\(\)/)
  assert.doesNotMatch(cuerpo, /status/, 'filtrar por estado reabre el hueco de los perfiles aún no activos')
})

test('no decide por negocio: ni cambia el default de data_scope ni toca users', () => {
  // Qué ve un closer, un setter o un CSM es una decisión del dueño, no un arreglo de seguridad.
  assert.doesNotMatch(codigo, /ALTER TABLE/i)
  assert.doesNotMatch(codigo, /data_scope\s*(SET|DEFAULT)/i)
  assert.doesNotMatch(codigo, /UPDATE\s+public\.users/i)
})

test('es atómica: todo o nada', () => {
  assert.match(codigo, /^\s*BEGIN;/)
  assert.match(codigo, /COMMIT;\s*$/)
})
