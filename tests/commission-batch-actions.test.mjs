import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const route = await readFile('app/api/[tenant]/evergreen/commissions/batch/route.ts', 'utf8')
const page = await readFile('app/[tenant]/comisiones/page.tsx', 'utf8')
const table = await readFile('components/commissions/CommissionsTable.tsx', 'utf8')

test('la ruta de lote exige admin/director y acota por tenant', () => {
  assert.match(route, /\['admin', 'director'\]/)
  assert.match(route, /\.eq\('tenant_id', t\.tenantId\)/g)
  assert.match(route, /between pending and approved|pending.*approved|approved.*liquidated/s)
  assert.match(route, /audit_logs/)
})

test('la UI ofrece aprobar y liquidar sobre la lista filtrada', () => {
  assert.match(page, /filterMonth/)
  assert.match(page, /filterMember/)
  assert.match(page, /handleBatchStatus/)
  assert.match(page, /onLiquidate=\{handleLiquidate\}/)
  assert.match(table, /Liquidar seleccionadas/)
  assert.match(table, /Aprobar seleccionadas/)
})
