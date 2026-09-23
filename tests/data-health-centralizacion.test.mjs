// Regresión: centralización de la calidad de datos en Data Health + tarjeta "contactos sin canal".
// - El diagnóstico de calidad YA NO se calcula ni presenta en unit-economics (su casa es Data Health).
// - El panel de unit-economics queda como funnel canónico (analítica), sin calidad.
// - Data Health expone y pinta el hueco de captura "contactos sin canal" (vivos, excluyendo fusionados).
// Patrón del repo: verificación por fuente de rutas/componentes + lógica pura replicada congelada.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

const page = leer('app/[tenant]/unit-economics/page.tsx')
const panelOS = leer('components/os/DataQualityPanel.tsx')
const panelDH = leer('components/settings/DataHealthPanel.tsx')
const endpoint = leer('app/api/[tenant]/evergreen/settings/data-health/route.ts')

test('unit-economics ya no calcula ni presenta el diagnóstico de calidad', () => {
  assert.ok(!page.includes('DataQualityPanel quality='), 'unit-economics aún usa el componente de calidad')
  assert.ok(!page.includes('QualityStats'), 'unit-economics aún tipa contra QualityStats')
  assert.ok(!page.includes('const calidad'), 'unit-economics aún calcula el objeto calidad')
  assert.ok(!page.includes('dedupeSales'), 'la dedupe de ventas (calidad) sigue en unit-economics')
  // El cash canónico (§2) es analítica, no calidad: se queda en la página.
  assert.match(page, /canonicalCash/)
  // Ningún identificador de calidad puede quedar en la página:
  for (const fantasma of [
    'duplicateLeads',
    'duplicatePayments',
    'sourceConflicts',
    'unattributedLeads',
    'paymentsWithoutSale',
  ]) {
    assert.ok(!page.includes(fantasma), `identificador de calidad "${fantasma}" sigue en unit-economics`)
  }
  // El funnel canónico (analítica) sí se queda:
  assert.match(page, /FunnelCanonicoPanel/)
  assert.match(page, /canonicalizeLeads/)
})

test('el panel de unit-economics es solo funnel y nombra a Data Health como casa de la calidad', () => {
  assert.ok(!panelOS.includes('Calidad de datos'), 'el panel OS aún presenta la tarjeta de calidad')
  assert.ok(!panelOS.includes('QualityStats'), 'el panel OS aún define QualityStats')
  assert.ok(!panelOS.includes('QualityRow'), 'el panel OS aún define la fila de calidad')
  assert.match(panelOS, /export function FunnelCanonicoPanel/)
  assert.match(panelOS, /Funnel del negocio/)
  assert.match(panelOS, /Data Health/)
})

test('Data Health pinta la tarjeta "Contactos sin canal"', () => {
  assert.match(panelDH, /label="Contactos sin canal"/)
  assert.match(panelDH, /leadChannelGaps/)
  assert.match(panelDH, /Captura de origen/)
})

test('el endpoint de Data Health calcula el hueco sobre contactos vivos, excluyendo fusionados', () => {
  assert.match(endpoint, /lead_channel,merged_into/)
  assert.match(
    endpoint,
    /leadChannelGaps: contacts\.filter\(\(item\) => !item\.lead_channel && !item\.merged_into\)\.length/
  )
})

// ── Lógica del hueco, replicada congelada (mismo patrón que otros tests del repo) ──
const huecosCaptura = (contactos) => contactos.filter((c) => !c.lead_channel && !c.merged_into).length

test('semántica del hueco: 0 real ≠ hueco, fusionado no es persona, NULL no cuenta como canal', () => {
  const contactos = [
    { lead_channel: 'calendly', merged_into: null }, // canal real → no hueco
    { lead_channel: '', merged_into: null }, // vacío → hueco (un vacío no es un dato)
    { lead_channel: null, merged_into: null }, // NULL → hueco
    { lead_channel: null, merged_into: 'uuid-otro' }, // fusionado → no es persona, no cuenta
    { lead_channel: 'stripe', merged_into: 'uuid-otro' }, // fusionado con canal → tampoco
  ]
  assert.equal(huecosCaptura(contactos), 2)
  assert.equal(huecosCaptura([]), 0)
})
