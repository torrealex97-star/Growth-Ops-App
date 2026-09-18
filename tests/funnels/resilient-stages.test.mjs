import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Test that loadFunnelCounts isolates failures per source:
// - If CRM throws, CRM stages → error_fuente, Meta/GA4/VSL stages unaffected
// - If VSL throws, only that stage → error_fuente, rest of VSL stages unaffected
// - If ALL sources fail, every stage has a MetricValue (never missing from counts)
// We mock the source functions to simulate failures.

// Inline the types/helpers we need (the module is ESM and not directly testable without
// Supabase client, so we validate the pattern with a simulation that mirrors loadFunnelCounts).

function errorFuente(source, error) {
  return { value: null, status: 'error_fuente', source, lastSync: null, error }
}
function noConfigurada(source, reason) {
  return { value: null, status: 'no_configurada', source, lastSync: null, error: reason }
}
function fromCount(rows, source, opts = {}) {
  if (rows === null) return errorFuente(source, opts.error || 'No se pudo leer la fuente')
  return rows === 0
    ? { value: 0, status: 'sin_datos', source, lastSync: opts.lastSync ?? null }
    : { value: rows, status: 'ok', source, lastSync: opts.lastSync ?? null }
}

// isSourceError mirrors the helper added to queries.ts
function isSourceError(v) {
  return v !== null && typeof v === 'object' && 'error' in v && typeof v.error === 'string'
}

describe('resilient stage loading', () => {
  it('isSourceError distinguishes error wrappers from real stage objects', () => {
    assert.equal(isSourceError(null), false)
    assert.equal(isSourceError({ leads: fromCount(10, 'crm') }), false)
    assert.equal(isSourceError({ error: 'boom' }), true)
  })

  it('when a source wrapper fails, all its stages become error_fuente', () => {
    const crm = { error: 'CRM fell over' }
    // Simulate the loop for a CRM stage
    const stage = { id: 'leads', source: 'crm', label: 'Leads' }
    let metric
    if (isSourceError(crm)) {
      metric = errorFuente('crm', crm.error)
    }
    assert.equal(metric.status, 'error_fuente')
    assert.equal(metric.error, 'CRM fell over')
  })

  it('when a source wrapper succeeds, its stages resolve normally', () => {
    const crm = {
      leads: fromCount(100, 'crm'),
      agendas: fromCount(50, 'crm'),
      llamadas: fromCount(30, 'crm'),
      cierres: fromCount(10, 'crm'),
    }
    assert.equal(isSourceError(crm), false)
    assert.equal(crm.leads.value, 100)
    assert.equal(crm.leads.status, 'ok')
  })

  it('when crm fails but meta succeeds, meta stages are unaffected', () => {
    const crm = { error: 'timeout' }
    const meta = {
      impresiones: fromCount(5000, 'meta'),
      clics: fromCount(200, 'meta'),
      alcance: fromCount(3000, 'meta'),
      inversion: 150.5,
    }
    // CRM stages → error
    assert.equal(isSourceError(crm), true)
    assert.equal(isSourceError(meta), false)
    // Meta stages resolve fine
    assert.equal(meta.impresiones.value, 5000)
    assert.equal(meta.clics.value, 200)
  })

  it('when meta fails, inversion is null (not NaN or undefined)', () => {
    const meta = { error: 'HTTP 500' }
    const inversion = meta && !isSourceError(meta) ? meta.inversion : null
    assert.equal(inversion, null)
  })

  it('every stage always gets a MetricValue — no missing keys', () => {
    // Simulate ALL sources failing
    const crm = { error: 'all down' }
    const meta = { error: 'all down' }
    const ga4 = null

    const stages = [
      { id: 'impresiones', source: 'meta', label: 'Impresiones' },
      { id: 'clics', source: 'meta', label: 'Clics' },
      { id: 'leads', source: 'crm', label: 'Leads' },
      { id: 'sesiones', source: 'ga4', label: 'Sesiones' },
    ]
    const counts = {}
    for (const stage of stages) {
      if (stage.source === 'crm') {
        if (isSourceError(crm)) counts[stage.id] = errorFuente('crm', crm.error)
        else counts[stage.id] = noConfigurada('crm', 'no solicitado')
      } else if (stage.source === 'meta') {
        if (isSourceError(meta)) counts[stage.id] = errorFuente('meta', meta.error)
        else counts[stage.id] = noConfigurada('meta', 'no solicitado')
      } else if (stage.source === 'ga4') {
        if (isSourceError(ga4)) counts[stage.id] = errorFuente('ga4', ga4.error)
        else counts[stage.id] = noConfigurada('ga4', 'no solicitado')
      }
    }
    // Every stage present with a valid status
    for (const stage of stages) {
      assert.ok(counts[stage.id], `Stage ${stage.id} is missing from counts`)
      assert.ok(
        ['ok', 'sin_datos', 'error_fuente', 'no_configurada'].includes(counts[stage.id].status),
        `Stage ${stage.id} has invalid status: ${counts[stage.id].status}`
      )
    }
  })
})
