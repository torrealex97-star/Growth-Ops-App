import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const helper = readFileSync(join(root, 'lib/integrations/ghl-attribution.ts'), 'utf8')
const webhook = readFileSync(join(root, 'app/api/[tenant]/evergreen/webhooks/ghl/route.ts'), 'utf8')
const sync = readFileSync(join(root, 'lib/integrations/citas-sync.ts'), 'utf8')
const historyRoute = readFileSync(
  join(root, 'app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts'),
  'utf8'
)
const integrationsPage = readFileSync(join(root, 'app/[tenant]/settings/integraciones/page.tsx'), 'utf8')

test('GHL consulta la ficha completa solo cuando el evento no trae atribución', () => {
  assert.match(helper, /tieneEvidenciaAtribucionGhl\(payload\)/)
  assert.match(helper, /contacts\/\$\{encodeURIComponent\(contactId\)\}/)
  assert.match(helper, /AbortSignal\.timeout\(10_000\)/)
})

test('el enriquecimiento solo copia campos de atribución y no pisa datos del evento', () => {
  assert.match(helper, /const ATTRIBUTION_KEYS/)
  assert.match(helper, /actual === undefined \|\| actual === null \|\| actual === ''/)
  assert.doesNotMatch(helper, /Object\.assign\(evento, contacto\)/)
})

test('webhook y pull comparten el mismo enriquecimiento de contacto GHL', () => {
  assert.match(webhook, /enriquecerAtribucionDesdeContactoGhl\(payload, ghlContactId, cfg\.GHL_API_TOKEN\)/)
  assert.match(sync, /payloadContactoCache/)
  assert.match(sync, /enriquecerAtribucionDesdeContactoGhl\(event, ghlContactId, token\)/)
  assert.match(sync, /raw_payload: eventoConAtribucion/)
})

test('el histórico GHL se divide en lotes reanudables antes del timeout de Vercel', () => {
  assert.match(sync, /parseGhlHistoryCursor\(opts\.pageToken\)/)
  assert.match(sync, /nextPageToken = encodeGhlHistoryCursor\(\{ calendarIndex, eventIndex \}\)/)
  assert.match(historyRoute, /job: 'ghl-historico'/)
  assert.match(historyRoute, /modo: 'soloEventos'/)
  assert.match(historyRoute, /deadlineMs: Date\.now\(\) \+ 40_000/)
  assert.match(historyRoute, /tieneSiguienteLote: Boolean\(r\.nextPageToken\)/)
})

test('la UI conserva y reanuda cursores tanto de Calendly como de GHL', () => {
  assert.match(integrationsPage, /const resumable = g\.id === 'calendly' \|\| g\.id === 'ghl'/)
  assert.match(integrationsPage, /localStorage\.setItem\(resumeKey/)
  assert.match(integrationsPage, /if \(!resumable \|\| !next\)/)
})
