import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sql = readFileSync(join(root, 'supabase/migrations/20260914170000_attribution_funnel_tenant_scope.sql'), 'utf8')

// P0 encontrado por el linter de Supabase y confirmado leyendo la definición en producción:
// `attribution_funnel()` era SECURITY DEFINER —salta la RLS— y no filtraba por tenant_id en ninguna
// de sus cuatro tablas, con EXECUTE para `authenticated` y expuesta en /rest/v1/rpc/. Cualquier
// usuario de cualquier subcuenta recibía leads, agendas, ventas y FACTURACIÓN de las demás.
test('attribution_funnel deja de ser SECURITY DEFINER', () => {
  assert.match(sql, /STABLE SECURITY INVOKER/)
  assert.ok(!/SECURITY DEFINER/.test(sql.replace(/^--.*$/gm, '')), 'no debe volver a ser DEFINER')
})

test('las cuatro tablas filtran por las subcuentas del usuario', () => {
  const ejecutable = sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  // Con INVOKER la RLS ya protege; el filtro explícito es la red por si alguien vuelve a marcarla
  // DEFINER. Es una función que devuelve dinero: no se deja colgando de una sola capa.
  assert.equal(
    (ejecutable.match(/IN \(SELECT public\.auth_tenant_ids\(\)\)/g) ?? []).length,
    4,
    'faltan filtros de subcuenta: contact_attributions, contacts, appointments y sales'
  )
  for (const tabla of ['contact_attributions', 'contacts', 'appointments', 'sales']) {
    assert.match(ejecutable, new RegExp(`public\\.${tabla}`), `falta ${tabla}`)
  }
})

test('anon sigue fuera y el search_path queda fijo', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.attribution_funnel\(\) FROM PUBLIC, anon;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.attribution_funnel\(\) TO authenticated;/)
  assert.match(sql, /SET search_path TO 'public'/)
  // El otro aviso del linter: merge_contacts repunta filas entre tablas, así que un search_path que
  // dependa de quien llama es una puerta a que resuelva nombres distintos de los previstos.
  assert.match(sql, /ALTER FUNCTION public\.merge_contacts\(UUID, UUID, UUID\) SET search_path TO 'public';/)
})

test('la limitación que queda está escrita, no escondida', () => {
  // La función no recibe la subcuenta, así que un super_admin con varias las verá sumadas. Eso se
  // documenta; lo que ya no ocurre es ver subcuentas a las que no perteneces.
  assert.match(sql, /LIMITACIÓN CONOCIDA/)
  assert.match(sql, /p_tenant_id/)
})
