import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const TENANT_SCOPED_VIEWS = [
  'app/[tenant]/actividad/page.tsx',
  'app/[tenant]/analitica/actividad/page.tsx',
  'app/[tenant]/analitica/embudo/page.tsx',
  'app/[tenant]/analitica/ranking/page.tsx',
  'app/[tenant]/cohorts/page.tsx',
  'app/[tenant]/dashboard/page.tsx',
  'app/[tenant]/students/page.tsx',
  'app/[tenant]/tasks/page.tsx',
  'app/[tenant]/unit-economics/page.tsx',
  'app/[tenant]/finanzas/analitica/proyeccion/page.tsx',
  'app/[tenant]/finanzas/analitica/resumen/page.tsx',
  'app/[tenant]/finanzas/gastos-facturas/facturas/page.tsx',
  'app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx',
  'app/[tenant]/finanzas/gastos-facturas/gestoria/page.tsx',
  'app/[tenant]/marketing/adquisicion/atribucion/page.tsx',
  'app/[tenant]/marketing/adquisicion/campanas/page.tsx',
  'app/[tenant]/marketing/afiliados/afiliados/page.tsx',
  'app/[tenant]/pnl/page.tsx',
  'app/[tenant]/csm-events/page.tsx',
  'app/[tenant]/drops/page.tsx',
  'app/[tenant]/contratos/page.tsx',
  'app/[tenant]/instagram/contenido/page.tsx',
]

test('las vistas de negocio resuelven y aplican el tenant activo explícitamente', () => {
  for (const file of TENANT_SCOPED_VIEWS) {
    const source = readFileSync(join(root, file), 'utf8')
    assert.match(source, /useTenantId/, `${file} no resuelve tenantId`)
    assert.match(source, /tenant_id/, `${file} no aplica tenant_id`)
  }
})

test('las escrituras críticas incluyen tenant_id en inserts y alcance en mutaciones', () => {
  const files = [
    'app/[tenant]/marketing/adquisicion/campanas/page.tsx',
    'app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx',
    'app/[tenant]/csm-events/page.tsx',
    'app/[tenant]/drops/page.tsx',
    'app/[tenant]/contratos/page.tsx',
    'app/[tenant]/instagram/contenido/page.tsx',
  ]
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8')
    assert.match(source, /insert\(\{\s*tenant_id: tenantId,/s, `${file} tiene inserts sin tenant_id`)
    assert.match(source, /\.eq\('tenant_id', tenantId\)/, `${file} tiene mutaciones sin alcance explícito`)
  }
})

test('la tabla global users solo expone y administra identidades del mismo tenant', () => {
  const migration = readFileSync(
    join(root, 'supabase/migrations/20260912130000_tenant_scope_users_rls.sql'),
    'utf8'
  )
  assert.match(migration, /JOIN public\.tenant_members target\s+ON target\.tenant_id = mine\.tenant_id/s)
  assert.match(migration, /public\.auth_can_view_user\(id\)/)
  assert.match(migration, /public\.auth_can_manage_user\(id\)/)
  assert.doesNotMatch(migration, /get_my_role\(\) IS NOT NULL/)
  assert.doesNotMatch(migration, /id = auth\.uid\(\) OR public\.auth_can_manage_user/)
})
