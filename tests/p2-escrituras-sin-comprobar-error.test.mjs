import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — tercera tanda del barrido de "escrituras sin comprobar { error }" (28-sep),
// hallazgos P2 del informe de auditoría (cachés, salida de agentes de IA, flags de
// sincronización de integraciones, audit_logs de configuración/CRM y limpieza E2E).
// Estilo de la casa: invariante estático sobre el fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8').replace(/\/\/[^\n]*/g, '')

test('webhooks/stripe: el evento no reconocido responde 500 (no 200 "registrado:true") si el insert falla', () => {
  const src = leer('app/api/[tenant]/evergreen/webhooks/stripe/route.ts')
  assert.match(src, /const \{ error: rechazoErr \} = await sb\.from\('raw_events'\)\.insert/)
  const idxCheck = src.indexOf('if (rechazoErr) {')
  const idx500 = src.indexOf("status: 500 }", idxCheck)
  assert.ok(idxCheck > -1 && idx500 > idxCheck, 'el rechazo por normalizador desconocido comprueba error y responde 500')
})

test('appointments/create: marcar el contacto como agendado comprueba error (no rompe la respuesta)', () => {
  const src = leer('app/api/[tenant]/evergreen/appointments/create/route.ts')
  assert.match(src, /const \{ error: leadStatusErr \} = await sb/g)
  assert.match(src, /no se pudo marcar el contacto como agendado/)
})

test('reels/generate: el guion generado responde ok:false si no se pudo guardar (no cuenta como created)', () => {
  const src = leer('lib/reels/generate.ts')
  assert.match(src, /Generado pero no guardado: \$\{saveErr\.message\}/)
})

test('ai/call y worker: el análisis de IA no se da por bueno si el guardado falla', () => {
  const ruta = leer('app/api/[tenant]/evergreen/ai/call/route.ts')
  assert.match(ruta, /Analizado pero no guardado: \$\{analysisErr\.message\}/)
  const worker = leer('worker/index.mjs')
  assert.match(worker, /Analizado pero no guardado: \$\{saveErr\.message\}/)
})

test('instagram/transcribe: el guardado final del análisis comprueba error antes de responder ok', () => {
  const src = leer('app/api/[tenant]/evergreen/instagram/transcribe/route.ts')
  assert.match(src, /Analizado pero no guardado: \$\{saveErr\.message\}/)
})

test('data-health/dedupe: fusionar o borrar duplicados es irreversible — la auditoría comprueba error', () => {
  const src = leer('app/api/[tenant]/evergreen/settings/data-health/dedupe/route.ts')
  assert.match(src, /const \{ error: auditErr \} = await sb\.from\('audit_logs'\)\.insert/g)
  assert.match(src, /fusionados sin auditoría/)
  assert.match(src, /borradas sin auditoría/)
})

test('contacts create/[id]: alta y edición auditan con comprobación de error', () => {
  for (const ruta of ['app/api/[tenant]/evergreen/contacts/create/route.ts', 'app/api/[tenant]/evergreen/contacts/[id]/route.ts']) {
    const src = leer(ruta)
    assert.match(src, /const \{ error: auditErr \} = await sb\.from\('audit_logs'\)\.insert/, ruta)
  }
})

test('sync-runs: el cierre y el barrido de colgados comprueban error', () => {
  const src = leer('lib/integrations/sync-runs.ts')
  assert.match(src, /el barrido de ejecuciones colgadas falló/)
  assert.match(src, /no se pudo cerrar la ejecución/)
})

test('instagram/competitors: el sync de reels no se cuenta como hecho si el upsert falla', () => {
  const src = leer('app/api/[tenant]/evergreen/instagram/competitors/route.ts')
  const idxUpsert = src.indexOf("from('ig_competitor_media')\n        .upsert(rows")
  const idxCheck = src.indexOf('if (error) {', idxUpsert)
  assert.ok(idxUpsert > -1 && idxCheck > idxUpsert, 'el upsert masivo de reels comprueba error antes de contar synced')
})

test('e2e-seed: el cleanup por tenant reporta errores en vez de ok:true silencioso', () => {
  const src = leer('supabase/functions/e2e-seed/index.ts')
  assert.match(src, /const errores: string\[\] = \[\]/)
  assert.match(src, /ok: errores\.length === 0/)
})
