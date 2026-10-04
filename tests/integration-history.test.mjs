import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('Fathom figura en el catálogo con API y MCP oficial', async () => {
  const catalog = await read('lib/integrations-catalog.ts')
  assert.match(catalog, /id: 'fathom'/)
  assert.match(catalog, /FATHOM_API_KEY/)
  assert.match(catalog, /https:\/\/api\.fathom\.ai\/mcp/)
})

test('la carga histórica está limitada al tenant autenticado', async () => {
  const route = await read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.match(route, /requireTenant\(tenant\)/)
  // El tenantId SIEMPRE sale de la sesión (requireTenant), nunca del cliente; cada consulta de la
  // ingesta canónica llega acotada a esa subcuenta.
  assert.match(route, /auth\.tenantId/)
  const ingesta = await read('lib/fathom/ingesta.ts')
  assert.match(ingesta, /\.eq\('tenant_id', tenantId\)/)
  assert.match(route, /provider === 'ghl'/)
  assert.match(route, /provider === 'calendly'/)
  assert.match(route, /provider === 'fathom'/)
})

test('los imports actualizan o insertan sin borrar históricos', async () => {
  const route = await read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.doesNotMatch(route, /\.delete\(/)
  // La escritura de la transcripción vive en la ingesta canónica (histórico + webhook).
  const ingesta = await read('lib/fathom/ingesta.ts')
  assert.match(ingesta, /transcript_status: transcript \? 'listo' : 'no_aplica'/)
  // La implementación de citas (Calendly/GHL) vive en la lib compartida con el cron: los
  // invariantes de upsert idempotente se comprueban donde está el código.
  const citas = await read('lib/integrations/citas-sync.ts')
  assert.match(citas, /appointmentsImported/)
  assert.match(citas, /appointmentsUpdated/)
  assert.doesNotMatch(citas, /\.delete\(/)
})
