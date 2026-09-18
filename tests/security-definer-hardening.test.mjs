import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationSql = readFileSync(
  join(root, 'supabase/migrations/20260917100000_security_definer_execute_hardening.sql'),
  'utf8'
)

test('la migración de hardening revoca acceso a funciones de trigger', () => {
  const triggers = [
    'handle_updated_at',
    'suggestions_set_resolved_at',
    'positive_notes_set_updated_at',
    'partners_check_profit_total',
  ]
  for (const fn of triggers) {
    const linea = `REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated;`
    assert.ok(migrationSql.includes(linea), `Falta revocar trigger ${fn}() de PUBLIC, anon, authenticated`)
  }
})

test('las 10 funciones helper RLS SECURITY DEFINER están revocadas de PUBLIC y anon', () => {
  const helpers = [
    'get_my_role',
    'is_admin_or_director',
    'my_data_scope',
    'auth_tenant_ids',
    'is_super_admin',
    'is_tenant_admin(UUID)',
    'auth_can_view_user(UUID)',
    'auth_can_manage_user(UUID)',
    'rol_recortado_en(UUID)',
    'rol_en_tenant(UUID)',
  ]
  for (const fn of helpers) {
    const firma = fn.endsWith('(UUID)') ? fn : `${fn}()`
    assert.ok(
      migrationSql.includes(`REVOKE ALL ON FUNCTION public.${firma} FROM PUBLIC, anon;`),
      `Falta REVOKE de PUBLIC, anon para ${fn}`
    )
    assert.ok(
      migrationSql.includes(`GRANT EXECUTE ON FUNCTION public.${firma} TO authenticated;`),
      `Falta GRANT EXECUTE a authenticated para ${fn}`
    )
  }
})

test('las funciones utilitarias de servicio están revocadas de anon y público', () => {
  assert.ok(migrationSql.includes('REVOKE ALL ON FUNCTION public.merge_contacts(UUID, UUID, UUID) FROM PUBLIC, anon;'))
  assert.ok(migrationSql.includes('REVOKE ALL ON FUNCTION public.contacts_get_or_create('))
})

// ----------------------------------------------------------------------------
// INVARIANTE DE ACICLICIDAD: is_my_collaborator_row / is_my_collaborator_sale
// son las únicas vías por las que contacts/appointments/sales/collections alcanzan
// contact_attributions y collaborator_profiles. Si dejan de ser SECURITY DEFINER,
// re-entran en RLS y el ciclo contacts↔attributions vuelve a romper producción
// (ver tests/rls-acyclicity.test.mjs, que modela esta regla en el grafo).
// ----------------------------------------------------------------------------
const colaboradoresSql = readFileSync(join(root, 'supabase/migrations/20260918150000_collaborators_core.sql'), 'utf8')

const FUNCIONES_COLABORADOR = ['is_my_collaborator_row(UUID)', 'is_my_collaborator_sale(UUID)']

function cuerpoDeFuncion(sql, prefijo) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${prefijo}`)
  assert.ok(inicio !== -1, `No se encuentra la función ${prefijo} en collaborators_core`)
  const fin = sql.indexOf('$$;', inicio)
  assert.ok(fin !== -1, `No se encuentra el cierre de ${prefijo}`)
  return sql.slice(inicio, fin)
}

test('las funciones de alcance de colaborador son SECURITY DEFINER (invariante de aciclicidad RLS)', () => {
  for (const firma of FUNCIONES_COLABORADOR) {
    const prefijo = firma.replace(/\(.*$/, '')
    const cuerpo = cuerpoDeFuncion(colaboradoresSql, prefijo)
    assert.match(
      cuerpo,
      /SECURITY DEFINER/,
      `${firma} debe ser SECURITY DEFINER: si pasa a invoker, re-entra en RLS y reaparece el ciclo de recursión`
    )
    assert.match(cuerpo, /STABLE/, `${firma} debe ser STABLE (lectura pura dentro de policies)`)
  }
})

test('las funciones de colaborador solo son ejecutables por authenticated', () => {
  for (const firma of FUNCIONES_COLABORADOR) {
    assert.ok(
      colaboradoresSql.includes(`REVOKE ALL ON FUNCTION public.${firma} FROM PUBLIC, anon;`),
      `Falta REVOKE de PUBLIC, anon para ${firma}`
    )
    assert.ok(
      colaboradoresSql.includes(`GRANT EXECUTE ON FUNCTION public.${firma} TO authenticated;`),
      `Falta GRANT EXECUTE a authenticated para ${firma}`
    )
  }
})
