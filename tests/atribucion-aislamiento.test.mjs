import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sql = readFileSync(join(root, 'supabase/migrations/20260914170000_attribution_funnel_tenant_scope.sql'), 'utf8')
const expandSql = readFileSync(
  join(root, 'supabase/migrations/20260914180000_attribution_funnel_active_tenant.sql'),
  'utf8'
)
const contractSql = readFileSync(
  join(root, 'supabase/migrations/20260914181000_retire_legacy_attribution_funnel.sql'),
  'utf8'
)

// P0 encontrado por el linter de Supabase y confirmado leyendo la definición en producción:
// `attribution_funnel()` era SECURITY DEFINER —salta la RLS— y no filtraba por tenant_id en ninguna
// de sus cuatro tablas, con EXECUTE para `authenticated` y expuesta en /rest/v1/rpc/. Cualquier
// usuario de cualquier subcuenta recibía leads, agendas, ventas y FACTURACIÓN de las demás.
test('attribution_funnel deja de ser SECURITY DEFINER', () => {
  assert.match(sql, /STABLE SECURITY INVOKER/)
  assert.ok(!/SECURITY DEFINER/.test(sql.replace(/^--.*$/gm, '')), 'no debe volver a ser DEFINER')
})

test('la firma exige la subcuenta activa y las cuatro tablas filtran por ella', () => {
  const ejecutable = expandSql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  assert.match(ejecutable, /attribution_funnel_for_tenant\(p_tenant_id UUID\)/)
  for (const tabla of ['contact_attributions', 'contacts', 'appointments', 'sales']) {
    assert.match(ejecutable, new RegExp(`public\\.${tabla}`), `falta ${tabla}`)
  }
  assert.match(ejecutable, /t\.tenant_id = ca\.tenant_id/)
  assert.match(ejecutable, /t\.tenant_id = c\.tenant_id/)
  assert.match(ejecutable, /a\.tenant_id = p_tenant_id/)
  assert.match(ejecutable, /s\.tenant_id = p_tenant_id/)
  assert.match(ejecutable, /p_tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\) OR public\.is_super_admin\(\)/)
})

test('anon sigue fuera y el search_path queda fijo', () => {
  assert.match(contractSql, /REVOKE ALL ON FUNCTION public\.attribution_funnel\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(expandSql, /REVOKE ALL ON FUNCTION public\.attribution_funnel_for_tenant\(UUID\) FROM PUBLIC, anon;/)
  assert.match(expandSql, /GRANT EXECUTE ON FUNCTION public\.attribution_funnel_for_tenant\(UUID\) TO authenticated;/)
  assert.match(expandSql, /SECURITY INVOKER/)
  assert.ok(!/SECURITY DEFINER/.test(expandSql.replace(/^--.*$/gm, '')), 'la firma nueva no debe ser DEFINER')
  assert.match(expandSql, /SET search_path = public/)
  assert.match(sql, /SET search_path TO 'public'/)
  // El otro aviso del linter: merge_contacts repunta filas entre tablas, así que un search_path que
  // dependa de quien llama es una puerta a que resuelva nombres distintos de los previstos.
  assert.match(sql, /ALTER FUNCTION public\.merge_contacts\(UUID, UUID, UUID\) SET search_path TO 'public';/)
})

test('el cliente pasa la subcuenta activa al RPC', () => {
  const page = readFileSync(join(root, 'app/[tenant]/marketing/adquisicion/atribucion/page.tsx'), 'utf8')
  assert.match(page, /const tenantId = useTenantId\(\)/)
  assert.match(page, /rpc\('attribution_funnel_for_tenant', \{ p_tenant_id: tenantId \}\)/)
})
