import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { debeMarcarAsistencia, mapearEstadoExterno } from '../lib/appointments/status.ts'

// DOS FALLOS VIVOS DE LA AGENDA (22-sep), con GHL ya en uso:
//
//   1. La traducción de estados de GHL estaba DUPLICADA —una copia en el webhook, otra en la
//      sincronización por cron— y se habían separado: la del cron no normalizaba separadores, así que
//      "no-show" no coincidía con nada y la cita se guardaba como "programada". Una cita a la que
//      nadie asistió contada como viva infla la agenda y hunde la tasa de asistencia.
//   2. Nadie marcaba la asistencia al llegar la grabación: 107 citas tenían grabación de Fathom y
//      solo 3 figuraban como asistidas.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// ── TRADUCCIÓN DE ESTADOS ────────────────────────────────────────────────────────────────────

test('las variantes de "no asistió" se reconocen todas', () => {
  for (const crudo of ['noshow', 'no_show', 'no-show', 'No Show', 'NOSHOW', 'missed', 'absent', 'no asistió']) {
    assert.equal(mapearEstadoExterno(crudo), 'no_show', `"${crudo}" debería ser no_show`)
  }
})

test('las variantes de "asistió" también', () => {
  for (const crudo of ['showed', 'show', 'attended', 'asistió', 'ASISTIO']) {
    assert.equal(mapearEstadoExterno(crudo), 'show', `"${crudo}"`)
  }
  assert.equal(mapearEstadoExterno('completed'), 'completed')
})

test('"invalid" de GHL es una cita anulada, no una cita viva', () => {
  // Antes caía en el valor por defecto y quedaba como "programada": una cita fantasma para siempre.
  assert.equal(mapearEstadoExterno('invalid'), 'cancelled')
})

test('un estado desconocido devuelve null: no se inventa un valor', () => {
  assert.equal(mapearEstadoExterno('lo_que_sea'), null)
  assert.equal(mapearEstadoExterno(null), null)
  assert.equal(mapearEstadoExterno(42), null)
})

test('la traducción es UNA sola, compartida por el webhook y el cron', () => {
  const webhook = leer('app/api/[tenant]/evergreen/webhooks/ghl/route.ts')
  const sync = leer('lib/integrations/citas-sync.ts')
  for (const [nombre, src] of [
    ['webhook', webhook],
    ['citas-sync', sync],
  ]) {
    assert.match(src, /mapearEstadoExterno/, `${nombre}: no usa la traducción compartida`)
  }
  // Y ninguno vuelve a llevar su propia cadena de condiciones sobre 'showed'/'noshow'.
  assert.doesNotMatch(sync, /rawStatus === 'showed'/)
  assert.doesNotMatch(webhook, /\['show', 'showed', 'attended'/)
})

// ── LA GRABACIÓN MARCA LA ASISTENCIA ─────────────────────────────────────────────────────────

test('una cita sin resolver se marca como asistida', () => {
  for (const estado of [null, undefined, 'scheduled', 'confirmed', 'rescheduled']) {
    assert.equal(debeMarcarAsistencia(estado), true, `${estado}`)
  }
})

test('una decisión ya tomada no se pisa', () => {
  // Alguien puso "no asistió", o la cita está cancelada: la grabación no lo contradice
  // necesariamente, y quien lo puso sabe más que este automatismo.
  for (const estado of ['no_show', 'cancelled', 'cancelled_admin', 'cancelled_lead', 'show', 'completed']) {
    assert.equal(debeMarcarAsistencia(estado), false, `${estado}`)
  }
})

test('al emparejar la grabación, la asistencia se escribe aparte y solo sobre lo no resuelto', () => {
  const ruta = leer('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  const bloque = ruta.slice(ruta.indexOf('LA GRABACIÓN PRUEBA'))
  assert.match(bloque, /update\(\{ status: 'show' \}\)/)
  assert.match(bloque, /\.in\('status', ESTADOS_SIN_RESOLVER\)/, 'sin este filtro se pisarían decisiones humanas')
  assert.match(bloque, /\.eq\('tenant_id', tenantId\)/, 'acotado a la subcuenta')
  // Va DESPUÉS de guardar grabación y transcripción: si falla, el dato principal ya está.
  assert.ok(ruta.indexOf('recording_url: fathomMeetingId') < ruta.indexOf("update({ status: 'show' })"))
})
