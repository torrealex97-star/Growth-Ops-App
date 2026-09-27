// REGLA DE LA SECCIÓN DE ADS: el gasto y las campañas que se muestran SOLO son las de las cuentas
// seleccionadas en Integraciones (META_AD_ACCOUNT_ID). La tabla conserva históricos de cuentas ya
// deseleccionadas: cualquier lector que agregue campaign_daily/campaigns sin filtrar mezcla dinero
// que no es del negocio. Esta regresión fija el filtro en CADA punto de lectura descubierto en la
// auditoría del 23-sep (patrón del repo: verificación por fuente).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '')

// ── 1. Endpoints de métricas Meta ───────────────────────────────────────────

test('spend-range filtra campaign_daily por las cuentas de Integraciones', () => {
  const c = sinComentarios(leer('app/api/[tenant]/evergreen/meta/spend-range/route.ts'))
  assert.match(c, /getTenantConfigWithFallback/)
  assert.match(c, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
  assert.match(c, /in\('account_id', activeAccountIds\)/)
})

test('daily-actions filtra campaign_daily por las cuentas de Integraciones', () => {
  const c = sinComentarios(leer('app/api/[tenant]/evergreen/meta/daily-actions/route.ts'))
  assert.match(c, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
  assert.match(c, /in\('account_id', activeAccountIds\)/)
})

test('daily-funnel (métricas diarias de ads) filtra campaign_daily por las cuentas de Integraciones', () => {
  const c = sinComentarios(leer('app/api/[tenant]/evergreen/meta/daily-funnel/route.ts'))
  assert.match(c, /getTenantConfigWithFallback/)
  assert.match(c, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
  assert.match(c, /in\('account_id', activeAccountIds\)/)
})

// ── 2. Capa de métricas (IA + brief) ────────────────────────────────────────

test('consultarMetricas acepta cuentasAds y filtra campaign_daily con ellas', () => {
  const c = sinComentarios(leer('lib/metrics/consulta.ts'))
  assert.match(c, /cuentasAds: string\[\] = \[\]/)
  assert.match(c, /in\('account_id', cuentasAds\)/)
})

test('las dos rutas que consumen consultarMetricas le pasan la selección', () => {
  for (const ruta of [
    'app/api/[tenant]/evergreen/metricas/brief/route.ts',
    'app/api/[tenant]/evergreen/ai/agent/route.ts',
  ]) {
    const c = sinComentarios(leer(ruta))
    assert.match(c, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/, `${ruta} debe pasar la selección`)
    assert.match(c, /consultarMetricas\([^)]*parseAccountIds/, `${ruta} debe pasarla a consultarMetricas`)
  }
})

// ── 3. Funnels: la inversión del embudo ─────────────────────────────────────

test('metaStages filtra la inversión del funnel por cuentas de Integraciones', () => {
  const c = sinComentarios(leer('lib/funnels/queries.ts'))
  // El filtro de cuentas convive con el de asignaciones manuales (dos .in condicionales).
  assert.match(c, /if \(ids\) q = q\.in\('campaign_id', ids\)/)
  assert.match(c, /if \(cuentasAds\.length > 0\) q = q\.in\('account_id', cuentasAds\)/)
  assert.match(c, /cuentasAds: string\[\] = \[\]/)
})

test('la ruta de funnels pasa la selección de Integraciones al motor', () => {
  const c = sinComentarios(leer('app/api/[tenant]/evergreen/funnels/route.ts'))
  assert.match(c, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
})

// ── 4. Tools del agente de IA ───────────────────────────────────────────────

test('las tools de campaigns del agente filtran por la selección via ctx.env', () => {
  const c = sinComentarios(leer('lib/ai/agent/tools.ts'))
  assert.match(c, /parseAccountIds\(env\?\.META_AD_ACCOUNT_ID\)/)
  // Las tres tools que leen campaigns pasan por el filtro.
  assert.match(c, /campanasDeCuentas\(\(campaigns as Campaign\[\]\) \|\| \[\], cuentasAds\)/)
  assert.match(c, /campanasDeCuentas\(\(data as Campaign\[\]\) \|\| \[\], cuentasAdsDeContexto\(env\)\)/)
  assert.match(c, /campanasDeCuentas\(\(data as Campaign\[\]\) \|\| \[\], cuentasAdsDeContexto\(env\)\)/)
})

test('los detectores de anomalías reciben la config para poder filtrar', () => {
  const c = sinComentarios(leer('lib/ai/insights/detectors.ts'))
  assert.match(c, /env\?: Record<string, string \| undefined>/)
  const cron = sinComentarios(leer('app/api/[tenant]/evergreen/cron/ai-insights/route.ts'))
  assert.match(cron, /getTenantConfigWithFallback\(tenantId\)/)
  assert.match(cron, /detectAnomalies\(tenantId, sb, env\)/)
})

// ── 5. Data Health: la fuga inversa es visible ──────────────────────────────

test('Data Health reporta campañas sincronizadas de cuentas NO seleccionadas', () => {
  const modulo = leer('lib/data-health/cross-source.ts')
  assert.match(modulo, /'campana_cuenta_no_seleccionada'/)
  const ruta = sinComentarios(leer('app/api/[tenant]/evergreen/settings/data-health/route.ts'))
  assert.match(ruta, /campanasFueraDeSeleccion:/)
  // Con selección vacía ("todas las accesibles") no hay fuga posible: la ruta no la inventa.
  assert.match(ruta, /seleccionadas\.size > 0/)
})

// ── 6. El convenio vacío = todas se mantiene en todos los filtros ──────────

test('ningún filtro convierte la selección vacía en cero: siempre condicional', () => {
  // El convenio de la app: lista vacía = TODAS las cuentas accesibles. Colapsar a 0 diría
  // "no hay gasto" cuando la realidad es "está viéndolo todo".
  for (const ruta of [
    'app/api/[tenant]/evergreen/meta/daily-funnel/route.ts',
    'app/api/[tenant]/evergreen/meta/spend-range/route.ts',
    'app/api/[tenant]/evergreen/meta/daily-actions/route.ts',
  ]) {
    const c = sinComentarios(leer(ruta))
    assert.match(c, /if \(activeAccountIds\.length > 0\)/, `${ruta} debe respetar vacío = todas`)
  }
  assert.match(sinComentarios(leer('lib/metrics/consulta.ts')), /if \(cuentasAds\.length > 0\)/)
  assert.match(sinComentarios(leer('lib/funnels/queries.ts')), /if \(cuentasAds\.length > 0\)/)
})
