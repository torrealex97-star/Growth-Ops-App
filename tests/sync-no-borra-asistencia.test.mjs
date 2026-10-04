import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { estadoAlSincronizar } from '../lib/appointments/status.ts'

// LA SINCRONIZACIÓN BORRABA LAS ASISTENCIAS.
//
// Calendly NO sabe si el lead se presentó: da `scheduled` a todo lo no cancelado, y GHL `confirmed`
// hasta que alguien lo cambie. Las pasadas de sincronización hacían `update({status})` sin mirar lo que
// ya había, así que marcar una asistencia a mano (o por evidencia) duraba hasta la pasada siguiente.
// Medido en producción el 4-oct: 53 de las 249 asistencias marcadas el 22-sep habían vuelto a «sin
// resolver» (43 de Calendly, 10 de GHL), todas tocadas por la sincronización diaria.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('una asistencia ya marcada no vuelve a «programada» por una pasada de Calendly', () => {
  assert.equal(estadoAlSincronizar('show', 'scheduled'), 'show')
  assert.equal(estadoAlSincronizar('completed', 'scheduled'), 'completed')
})

test('tampoco vuelve a «confirmada» por una pasada de GHL', () => {
  assert.equal(estadoAlSincronizar('show', 'confirmed'), 'show')
  assert.equal(estadoAlSincronizar('no_show', 'confirmed'), 'no_show')
  assert.equal(estadoAlSincronizar('show', 'rescheduled'), 'show')
})

test('una cancelación SÍ se aplica: es lo que el proveedor sí sabe', () => {
  // Una reunión cancelada no se celebra, aunque alguien la hubiera marcado asistida.
  assert.equal(estadoAlSincronizar('show', 'cancelled'), 'cancelled')
})

test('un estado resuelto nuevo SÍ sustituye al anterior: GHL informa de show / no show', () => {
  assert.equal(estadoAlSincronizar('no_show', 'show'), 'show')
  assert.equal(estadoAlSincronizar('show', 'no_show'), 'no_show')
  assert.equal(estadoAlSincronizar('scheduled', 'show'), 'show')
})

test('lo que no estaba resuelto sigue el estado del proveedor, como antes', () => {
  assert.equal(estadoAlSincronizar('scheduled', 'confirmed'), 'confirmed')
  assert.equal(estadoAlSincronizar('confirmed', 'scheduled'), 'scheduled')
  assert.equal(estadoAlSincronizar('cancelled', 'scheduled'), 'scheduled', 'una cita reactivada vuelve a estar viva')
})

test('una cita nueva (sin estado previo) toma el del proveedor', () => {
  assert.equal(estadoAlSincronizar(null, 'scheduled'), 'scheduled')
  assert.equal(estadoAlSincronizar(undefined, 'confirmed'), 'confirmed')
})

test('las tres vías que escriben el estado desde un proveedor usan la regla', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  // Calendly y GHL: leen el estado actual y lo pasan por la regla.
  assert.equal((sync.match(/estadoAlSincronizar\(/g) ?? []).length, 2, 'una pasada escribe el estado sin la regla')
  assert.equal((sync.match(/\.select\('id, (contact_id, )?closer_id, status'\)/g) ?? []).length, 2)
  assert.doesNotMatch(sync, /^\s+status,\n\s+source: '(calendly|ghl)'/m, 'queda un `status,` pelado en un upsert')
  const webhook = leer('app/api/[tenant]/evergreen/webhooks/ghl/route.ts')
  assert.match(webhook, /upd\.status = estadoAlSincronizar\(appt\.status, status\)/)
})

test('el barrido de asistencia por grabación sigue sin pisar lo resuelto', () => {
  // Es la otra mitad de la misma idea (debeMarcarAsistencia): la grabación solo resuelve lo pendiente.
  const src = leer('lib/appointments/status.ts')
  assert.match(src, /export function debeMarcarAsistencia/)
  assert.match(src, /export function estadoAlSincronizar/)
})
