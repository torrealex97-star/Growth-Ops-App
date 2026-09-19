import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// La lógica pura se EJECUTA de verdad (node:test compila el .ts).
const estados = await import('../lib/email/estados.ts')
const { mapResendEventToStatus, shouldAdvanceStatus, missingMessageAction, MISSING_MESSAGE_MAX_AGE_SEC } = estados

// ── Mapper de eventos → estados internos ─────────────────────────────────────

test('mapper: todos los eventos relevantes de Resend mapean a estado interno', () => {
  assert.equal(mapResendEventToStatus('email.sent'), 'SENT')
  assert.equal(mapResendEventToStatus('email.delivered'), 'DELIVERED')
  assert.equal(mapResendEventToStatus('email.opened'), 'OPENED')
  assert.equal(mapResendEventToStatus('email.clicked'), 'CLICKED')
  assert.equal(mapResendEventToStatus('email.bounced'), 'BOUNCED')
  assert.equal(mapResendEventToStatus('email.bounced.hard'), 'BOUNCED')
  assert.equal(mapResendEventToStatus('email.bounced.soft'), 'BOUNCED')
  assert.equal(mapResendEventToStatus('email.complained'), 'COMPLAINED')
  assert.equal(mapResendEventToStatus('email.failed'), 'FAILED')
  assert.equal(mapResendEventToStatus('email.received'), null, 'evento no relevante → null')
  assert.equal(mapResendEventToStatus(''), null)
  assert.equal(mapResendEventToStatus('otro.evento'), null)
})

// ── No-retroceso de la línea temporal ────────────────────────────────────────

test('no-retroceso: DELIVERED nunca vuelve a SENT; fallo tras entrega sí avanza', () => {
  assert.equal(shouldAdvanceStatus('SENT', 'SENT'), false, 'mismo estado no reescribe timestamps')
  assert.equal(shouldAdvanceStatus('DELIVERED', 'SENT'), false)
  assert.equal(shouldAdvanceStatus('DELIVERED', 'DELIVERED'), false)
  assert.equal(shouldAdvanceStatus('OPENED', 'SENT'), false)
  assert.equal(shouldAdvanceStatus('CLICKED', 'DELIVERED'), false)
  assert.equal(shouldAdvanceStatus('SENT', 'DELIVERED'), true)
  assert.equal(shouldAdvanceStatus('SENT', 'OPENED'), true)
  assert.equal(shouldAdvanceStatus('DELIVERED', 'BOUNCED'), true, 'rebote tras entrega avanza (rango terminal)')
  assert.equal(shouldAdvanceStatus('QUEUED', 'SENT'), true)
  assert.equal(shouldAdvanceStatus('estado-desconocido', 'SENT'), true, 'estado desconocido no bloquea')
})

// ── Carrera: evento llega antes de que el INSERT del envío se commitara ──────

test('carrera webhook: reciente+verificado reintenta; viejo o sin verificación se ignora', () => {
  assert.equal(
    missingMessageAction({ verified: true, eventAgeSec: 5 }),
    'retry',
    'recién entregado: el INSERT está en vuelo → 500 para que Resend reintente'
  )
  assert.equal(missingMessageAction({ verified: true, eventAgeSec: 599 }), 'retry')
  assert.equal(
    missingMessageAction({ verified: true, eventAgeSec: 601 }),
    'ignore',
    'id desconocido con evento viejo no es una carrera'
  )
  assert.equal(
    missingMessageAction({ verified: true, eventAgeSec: null }),
    'retry',
    'sin timestamp known: mejor reintentar'
  )
  assert.equal(
    missingMessageAction({ verified: false, eventAgeSec: 5 }),
    'ignore',
    'modo dev inseguro no provoca reintentos'
  )
  assert.ok(MISSING_MESSAGE_MAX_AGE_SEC === 600)
})

// ── Cadena del id real (provider → send* → historial) ────────────────────────

test('provider: los 8 send* capturan data.id y lo exponen como messageId', () => {
  const resend = read('lib/email/resend.ts')
  const sends = (resend.match(/const \{ data, error \} = await resend\.emails\.send\(/g) ?? []).length
  assert.equal(sends, 8, `cada envío debe capturar data (hay ${sends})`)
  const ids = (resend.match(/return \{ ok: true, messageId: data\?\.id \}/g) ?? []).length
  assert.equal(ids, 8, `cada envío debe devolver messageId (hay ${ids})`)
  assert.match(resend, /Promise<\{ ok: boolean; error\?: string; messageId\?: string \}>/)
})

test('EmailService: persiste provider_message_id solo en envío OK y lo propaga', () => {
  const svc = read('lib/email/service.ts')
  assert.match(
    svc,
    /provider_message_id: result\.ok \? \(result\.messageId \?\? null\) : null/,
    'envío fallido → sin id (FAILED nunca lleva provider_message_id)'
  )
  assert.match(svc, /messageId: result\.messageId/, 'el resultado de sendEmail expone el id')
  // dispatch tipado con messageId (el compilador lo exige, el test lo ancla)
  assert.match(svc, /Promise<\{ ok: boolean; error\?: string; messageId\?: string \}> \{/)
})

test('webhook: asocia por provider_message_id y si falla el registro del evento NO actualiza estado', () => {
  const wh = read('app/api/webhooks/resend/route.ts')
  assert.match(wh, /eq\('provider_message_id', providerMessageId\)/)
  // Guard del insert de eventos: fallo → 500 (Resend reintenta, el estado no se pierde)
  assert.match(wh, /if \(evErr\)/, 'el fallo del insert de eventos debe abortar con 500')
  assert.match(wh, /no se pudo registrar el evento/)
  // La decisión de carrera viene del módulo puro (ejecutable), no inline
  assert.match(wh, /missingMessageAction\(/)
  assert.match(wh, /svixOk/, 'la verificación real alimenta la decisión de carrera')
})
