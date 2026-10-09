import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const helper = readFileSync(join(root, 'lib/integrations/ghl-attribution.ts'), 'utf8')
const webhook = readFileSync(join(root, 'app/api/[tenant]/evergreen/webhooks/ghl/route.ts'), 'utf8')
const sync = readFileSync(join(root, 'lib/integrations/citas-sync.ts'), 'utf8')

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
