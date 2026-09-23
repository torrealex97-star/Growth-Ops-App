import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  NORMALIZADOR_GHL,
  huellaEvento,
  idEventoGhl,
  propiedadesSinPii,
  sobreCrudoGhl,
  tipoEventoGhl,
} from '../lib/eventos/ghl.ts'

// F1 — LA CAPA EN BRUTO DEL WEBHOOK DE GHL.
//
// Hasta ahora el webhook leía el payload, escribía contacto y cita, y TIRABA el sobre. Cuando el
// normalizador fallaba —un estado mal traducido, un campo que GHL empezó a mandar distinto— no había
// nada que reprocesar: el original ya no existía. Arreglar el parser servía para los eventos
// futuros, no para recuperar los días en que estuvo roto.
//
// Lo que estos tests atan: que el mismo hecho tenga SIEMPRE la misma identidad (o el reintento
// duplicaría), que el sobre se guarde ANTES de procesar, que toda salida lo cierre con lo que de
// verdad pasó, y que las propiedades no lleven datos personales.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ruta = readFileSync(join(root, 'app/api/[tenant]/evergreen/webhooks/ghl/route.ts'), 'utf8')

// ── IDENTIDAD DEL EVENTO ─────────────────────────────────────────────────────────────────────

test('si GHL manda un id de evento, ese es el id: no se inventa una huella', () => {
  assert.equal(idEventoGhl({ webhookId: 'wh_123', contactId: 'c1' }), 'wh_123')
  assert.equal(idEventoGhl({ eventId: 'ev_9' }), 'ev_9')
})

test('sin id, la huella es estable: el mismo hecho da el mismo identificador', () => {
  const hecho = {
    appointmentId: 'apt_1',
    contactId: 'c_1',
    startTime: '2026-09-23T10:00:00Z',
    status: 'confirmed',
    dateUpdated: '2026-09-23T09:00:00Z',
  }
  const a = idEventoGhl(hecho)
  // Mismo contenido, claves en otro orden y con un campo volátil añadido por la entrega.
  const b = idEventoGhl({
    status: 'confirmed',
    dateUpdated: '2026-09-23T09:00:00Z',
    contactId: 'c_1',
    startTime: '2026-09-23T10:00:00Z',
    appointmentId: 'apt_1',
    deliveryAttempt: 3,
  })
  assert.equal(a, b, 'un reintento de GHL tiene que caer en la misma fila')
  assert.match(a, /^hf_[0-9a-f]{40}$/, 'una huella se distingue de un id real de GHL')
})

test('dos cambios sobre la MISMA cita no se confunden entre sí', () => {
  // Mover una cita dos veces son dos hechos. Sin `dateUpdated` en la huella, el segundo se habría
  // descartado como duplicado del primero y la cita se quedaría en la hora vieja.
  const base = { appointmentId: 'apt_1', contactId: 'c_1', startTime: '2026-09-23T10:00:00Z' }
  const uno = idEventoGhl({ ...base, dateUpdated: '2026-09-23T09:00:00Z' })
  const dos = idEventoGhl({ ...base, dateUpdated: '2026-09-23T11:30:00Z' })
  assert.notEqual(uno, dos)
})

test('la huella no depende del orden de las claves', () => {
  assert.equal(huellaEvento({ a: '1', b: '2' }), huellaEvento({ b: '2', a: '1' }))
  assert.notEqual(huellaEvento({ a: '1' }), huellaEvento({ a: '2' }))
  // Ausente y vacío son lo mismo para la huella: GHL manda unas veces null y otras "".
  assert.equal(huellaEvento({ a: '1', b: null }), huellaEvento({ a: '1', b: undefined }))
})

// ── TIPO DEL HECHO ───────────────────────────────────────────────────────────────────────────

test('el tipo distingue cancelación, reprogramación, cita y contacto', () => {
  assert.equal(tipoEventoGhl({ event: 'AppointmentCancelled', appointmentId: 'a' }), 'ghl.cita.cancelada')
  assert.equal(tipoEventoGhl({ type: 'appointment_rescheduled', appointmentId: 'a' }), 'ghl.cita.reprogramada')
  assert.equal(tipoEventoGhl({ appointmentId: 'a' }), 'ghl.cita.registrada')
  assert.equal(tipoEventoGhl({ event: 'ContactCreate', contactId: 'c' }), 'ghl.contacto.actualizado')
  // Lo que no se reconoce se nombra como lo que es: un evento recibido. No se fuerza a "cita".
  assert.equal(tipoEventoGhl({ foo: 'bar' }), 'ghl.evento.recibido')
})

// ── PROPIEDADES SIN PII ──────────────────────────────────────────────────────────────────────

test('las propiedades llevan el hecho, nunca a la persona', () => {
  const props = propiedadesSinPii({
    appointmentId: 'apt_1',
    status: 'confirmed',
    utm_source: 'instagram',
    email: 'persona@example.test',
    phone: '+34600000000',
    firstName: 'Nombre',
    last_name: 'Apellido',
    fullName: 'Nombre Apellido',
    address1: 'Calle 1',
    message: 'texto privado del chat',
    notes: 'lo que contó en la llamada',
    contact: { email: 'otra@example.test' },
  })
  assert.deepEqual(props, { appointmentId: 'apt_1', status: 'confirmed', utm_source: 'instagram' })
})

test('ningún valor personal se cuela por un objeto anidado', () => {
  // El webhook ya aplana contact/appointment/customData: volver a guardar el anidado reintroduciría
  // por la puerta de atrás justo lo que se acaba de filtrar.
  const props = propiedadesSinPii({ appointment: { email: 'x@example.test' }, ok: 1 })
  assert.deepEqual(props, { ok: 1 })
})

// ── EL SOBRE ─────────────────────────────────────────────────────────────────────────────────

test('el sobre declara fuente, identidad, versión del normalizador y tamaño', () => {
  const sobre = sobreCrudoGhl({ webhookId: 'wh_1' }, 1234)
  assert.equal(sobre.source, 'ghl')
  assert.equal(sobre.source_event_id, 'wh_1')
  assert.equal(sobre.normalizer_version, NORMALIZADOR_GHL)
  assert.equal(sobre.payload_bytes, 1234)
  assert.equal(sobre.processing_status, 'received')
})

// ── EL WEBHOOK: ORDEN Y CIERRE ───────────────────────────────────────────────────────────────

test('el sobre se guarda ANTES de tocar contactos o citas', () => {
  const sobre = ruta.indexOf("from('raw_events')")
  const contacto = ruta.indexOf("from('contacts')")
  const cita = ruta.indexOf("from('appointments')")
  assert.ok(sobre > -1, 'el webhook no escribe capa en bruto')
  assert.ok(contacto > -1 && cita > -1, 'el webhook sigue escribiendo sus proyecciones')
  assert.ok(sobre < contacto, 'el sobre tiene que ir antes de escribir el contacto')
  assert.ok(sobre < cita, 'y antes de escribir la cita')
})

test('un reintento de GHL cae en la misma fila, no en una nueva', () => {
  assert.match(ruta, /onConflict: 'tenant_id,source,source_event_id'/)
})

test('guardar el sobre NUNCA puede tumbar la ingesta', () => {
  // Perder la capacidad de reprocesar es malo; perder la cita de un cliente, peor.
  const bloque = ruta.slice(ruta.indexOf('CAPA EN BRUTO'), ruta.indexOf('const responder'))
  assert.match(bloque, /try \{/)
  assert.match(bloque, /catch \(e\)/)
  assert.doesNotMatch(bloque, /throw/)
})

test('toda salida del webhook cierra el sobre con lo que pasó', () => {
  // Si una salida se saltara `responder`, ese sobre se quedaría en "recibido" para siempre y el
  // replay no sabría distinguir lo procesado de lo que se quedó a medias.
  const desde = ruta.indexOf('const responder')
  const hasta = ruta.indexOf('} catch (err) {', desde)
  const cuerpo = ruta.slice(desde, hasta)
  const sueltas = [...cuerpo.matchAll(/return NextResponse\.json\(/g)]
  assert.equal(sueltas.length, 1, 'solo la propia definición de responder puede responder directamente')
  assert.match(cuerpo, /processing_status: fallo \? 'rejected' : 'normalized'/)
})
