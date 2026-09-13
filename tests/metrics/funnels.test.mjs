import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFunnel } from '../../lib/funnels/compute.ts'
import { FUNNEL_DEFS, FUNNEL_FAMILIES, sourcesOf, stagesOf } from '../../lib/funnels/definitions.ts'
import { errorFuente, fromCount, isLimitedSource, isUsable, ok, sinDatos } from '../../lib/funnels/types.ts'

// ── El invariante que justifica todo el módulo ──────────────────────────────
// "no se pudo leer" y "no hay filas" son cosas distintas. Confundirlas es lo que convierte una
// integración caída en un "esta campaña no convierte".

test('un recuento no leído NO es cero', () => {
  const roto = fromCount(null, 'meta', { error: 'Meta respondió 500' })
  assert.equal(roto.status, 'error_fuente')
  assert.equal(roto.value, null, 'un error de fuente jamás debe valer 0')
  assert.equal(isUsable(roto), false)
  assert.match(roto.error, /500/)

  const vacio = fromCount(0, 'meta')
  assert.equal(vacio.status, 'sin_datos')
  assert.equal(vacio.value, 0, 'un 0 legítimo sí vale 0')
  assert.equal(isUsable(vacio), true)

  const conDatos = fromCount(42, 'meta', { lastSync: '2026-09-13T00:00:00Z' })
  assert.equal(conDatos.status, 'ok')
  assert.equal(conDatos.value, 42)
  assert.equal(conDatos.lastSync, '2026-09-13T00:00:00Z')
})

test('Clarity está marcada como fuente no apta para histórico', () => {
  assert.equal(isLimitedSource('clarity'), true)
  assert.equal(isLimitedSource('ga4'), false)
})

// ── Definiciones ───────────────────────────────────────────────────────────
test('las cuatro familias existen y todas acaban en cierres', () => {
  assert.deepEqual(FUNNEL_FAMILIES.sort(), ['profile', 'vsl', 'web_seo', 'webinar'])
  for (const family of FUNNEL_FAMILIES) {
    const stages = stagesOf(family)
    assert.ok(stages.length >= 4, `${family} tiene muy pocas etapas`)
    assert.equal(stages.at(-1).id, 'cierres', `${family} no termina en cierres`)
    // Ids únicos: se usan como clave del recuento, así que un duplicado silenciaría una etapa.
    assert.equal(new Set(stages.map((s) => s.id)).size, stages.length, `${family} repite ids de etapa`)
  }
  assert.deepEqual(sourcesOf('web_seo').sort(), ['crm', 'ga4'])
})

// ── Cálculo ────────────────────────────────────────────────────────────────
const counts = (pairs) => Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, ok(v, 'crm')]))

test('las conversiones se calculan sobre la etapa anterior y sobre la primera', () => {
  const r = computeFunnel({
    family: 'web_seo',
    counts: counts({ sesiones: 1000, leads: 100, agendas: 50, llamadas: 25, cierres: 5 }),
  })
  const by = Object.fromEntries(r.stages.map((s) => [s.stage.id, s]))
  assert.equal(by.sesiones.conversionFromTop, 100)
  assert.equal(by.sesiones.conversionFromPrevious, null, 'la primera etapa no tiene anterior')
  // sesiones son 'eventos' y leads 'personas': la tasa entre ambas no es comparable.
  assert.equal(by.leads.blockedBy, 'unidades_incompatibles')
  assert.equal(by.agendas.conversionFromPrevious, 50)
  assert.equal(by.llamadas.conversionFromPrevious, 50)
  assert.equal(by.cierres.conversionFromPrevious, 20)
  assert.equal(r.incomplete, false)
})

test('denominador 0 da null, no 0 ni Infinity', () => {
  const r = computeFunnel({
    family: 'web_seo',
    counts: counts({ sesiones: 0, leads: 0, agendas: 0, llamadas: 0, cierres: 0 }),
  })
  for (const s of r.stages) {
    assert.notEqual(s.conversionFromPrevious, Infinity)
    assert.ok(s.conversionFromPrevious === null, `${s.stage.id} debería ser null con denominador 0`)
  }
})

test('una etapa con la fuente caída no contamina las conversiones siguientes', () => {
  const r = computeFunnel({
    family: 'web_seo',
    counts: {
      ...counts({ sesiones: 1000, agendas: 50, llamadas: 25, cierres: 5 }),
      leads: errorFuente('crm', 'timeout'),
    },
  })
  const by = Object.fromEntries(r.stages.map((s) => [s.stage.id, s]))
  assert.equal(by.leads.blockedBy, 'error_fuente')
  assert.equal(by.leads.count.value, null)
  // agendas se compara con la última etapa FIABLE (sesiones), no con un hueco tratado como 0:
  // con leads=0 la conversión habría salido null o Infinity y el funnel parecería roto.
  assert.equal(by.agendas.blockedBy, 'unidades_incompatibles', 'debe avisar, no inventar una tasa')
  assert.equal(by.llamadas.conversionFromPrevious, 50)
  assert.equal(r.incomplete, true)
  assert.deepEqual(r.failedSources, ['crm'])
})

test('una etapa que no se ha calculado cuenta como no leída, no como cero', () => {
  const r = computeFunnel({ family: 'web_seo', counts: counts({ sesiones: 100 }) })
  assert.equal(r.incomplete, true)
  const cierres = r.stages.at(-1)
  assert.equal(cierres.count.status, 'error_fuente')
  assert.equal(cierres.count.value, null)
})

test('el coste por unidad solo aparece si se conoce la inversión', () => {
  const sin = computeFunnel({
    family: 'web_seo',
    counts: counts({ sesiones: 100, leads: 10, agendas: 5, llamadas: 4, cierres: 2 }),
  })
  assert.ok(sin.stages.every((s) => s.costPerUnit === null))

  const con = computeFunnel({
    family: 'web_seo',
    counts: counts({ sesiones: 100, leads: 10, agendas: 5, llamadas: 4, cierres: 2 }),
    inversion: 1000,
  })
  const by = Object.fromEntries(con.stages.map((s) => [s.stage.id, s]))
  assert.equal(by.cierres.costPerUnit, 500)
  assert.equal(by.leads.costPerUnit, 100)
})

test('sin_datos es utilizable: un 0 real se pinta como 0, no como fallo', () => {
  const r = computeFunnel({
    family: 'web_seo',
    counts: { ...counts({ sesiones: 100, leads: 10, agendas: 5, llamadas: 4 }), cierres: sinDatos('crm') },
  })
  const cierres = r.stages.at(-1)
  assert.equal(cierres.count.value, 0)
  assert.equal(cierres.conversionFromPrevious, 0, 'cero cierres sobre cuatro llamadas es un 0 % legítimo')
  assert.equal(r.incomplete, false, 'no hay ninguna fuente caída')
})

test('cada familia declara su descripción y su etiqueta', () => {
  for (const family of FUNNEL_FAMILIES) {
    assert.ok(FUNNEL_DEFS[family].label.length > 0)
    assert.ok(FUNNEL_DEFS[family].description.length > 0)
  }
})
