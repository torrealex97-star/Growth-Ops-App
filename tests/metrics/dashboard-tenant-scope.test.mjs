import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const pages = [
  'dashboard',
  'unit-economics',
  'finanzas/analitica/resumen',
  'finanzas/analitica/pnl',
  'finanzas/analitica/cohortes',
  'finanzas/analitica/proyeccion',
]

// Execute the actual page query expressions with the installed Supabase client.
// The HTTP fixture deliberately permits both tenants, as a multi-tenant admin can.
// This is a query-isolation regression, not a substitute for database RLS tests.
for (const page of pages) {
  test(`${page}: every initial query scopes the selected tenant, including users`, async () => {
    const source = readFileSync(new URL(`../../app/[tenant]/${page}/page.tsx`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let batch
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === 'Promise.all' &&
        node.getText(ast).includes('supabase')
      )
        batch ??= node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(batch, 'page must have its data query batch')
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      let requests = 0
      const supabase = createClient('https://example.supabase.co', 'public-test-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: async (input) => {
            requests++
            const url = new URL(String(input))
            const isUsers = url.pathname.endsWith('/users')
            const field = isUsers ? 'tenant_members.tenant_id' : 'tenant_id'
            const selected = url.searchParams.get(field)
            if (isUsers) assert.match(url.searchParams.get('select'), /tenant_members!inner\(tenant_id\)/)
            const rows = ['tenant-a', 'tenant-b']
              .filter((id) => !selected || selected === `eq.${id}`)
              .map((id) => ({ id }))
            return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
          },
        },
      })
      const run = new Function(
        'supabase',
        'tenantId',
        'FINANCE_QUERY_ROW_CAP',
        'sesion',
        `return ${batch.getText(ast)}`
      )
      const responses = await run(supabase, tenantId, 49999, { userId: 'user-fixture' })
      assert.ok(requests > 0)
      for (const response of responses) {
        assert.equal(response.error, null)
        assert.deepEqual(response.data, [{ id: tenantId }])
      }
    }
  })
}

test('campaign table CTR is a percentage and unavailable with zero impressions', () => {
  const source = readFileSync(
    new URL('../../app/[tenant]/marketing/adquisicion/campanas/page.tsx', import.meta.url),
    'utf8'
  )
  const expression = source.match(/const ctr = ([^\n]+)/)?.[1]
  assert.ok(expression)
  const calculate = new Function('c', 'div', `return ${expression}`)
  const div = (a, b) => (b > 0 ? a / b : null)
  assert.equal(calculate({ clicks: 28, impressions: 1000 }, div), 2.8)
  assert.equal(calculate({ clicks: 0, impressions: 1000 }, div), 0)
  assert.equal(calculate({ clicks: 0, impressions: 0 }, div), null)
})
