import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { TIPOS_DE_EVENTO, hechoDeCorreccion, hechoDesdeSobre, ocurridoEn } from '../lib/eventos/canonico.ts'
import { tipoEventoGhl } from '../lib/eventos/ghl.ts'
import { TENANT_A } from './fixtures/tenants-sinteticos.mjs'

// F1 — DEL SOBRE AL HECHO CANÓNICO.
//
// `raw_events` guarda lo que llegó; `canonical_events` guarda lo que significa. La propiedad que
// sostiene todo lo demás es que **el mismo evento no produzca dos hechos**: GHL reintenta cada
// entrega ante cualquier duda, y un hecho duplicado se convierte en una cita contada dos veces.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const ruta = leer('app/api/[tenant]/evergreen/webhooks/ghl/route.ts')

const base = {
  tenantId: TENANT_A.id,
  source: 'ghl',
  sourceEventId: 'wh_1',
  rawEventId: 'raw_1',
  tipo: 'ghl.cita.registrada',
  recibidoEn: '2026-09-23T12:00:00.000Z',
}

// ── CUÁNDO OCURRIÓ ───────────────────────────────────────────────────────────────────────────

test('la fecha del hecho es la del hecho, no la de recepción', () => {
  // Una cita de ayer que entra hoy por un reintento pertenece a AYER: si no, cambia de mes y con
  // ella las métricas del periodo.
  assert.equal(ocurridoEn({ startTime: '2026-09-22T10:00:00Z' }, base.recibidoEn), '2026-09-22T10:00:00.000Z')
  assert.equal(ocurridoEn({ appointment_date: '2026-09-21T08:30:00Z' }, base.recibidoEn), '2026-09-21T08:30:00.000Z')
})

test('sin fecha en el payload se usa la de recepción, no una inventada', () => {
  assert.equal(ocurridoEn({}, base.recibidoEn), base.recibidoEn)
  // Una fecha ilegible no se cuela como si fuera válida.
  assert.equal(ocurridoEn({ startTime: 'ayer por la tarde' }, base.recibidoEn), base.recibidoEn)
})

// ── EL HECHO ─────────────────────────────────────────────────────────────────────────────────

test('el hecho se identifica por el evento del proveedor: el reintento choca, no duplica', () => {
  const h = hechoDesdeSobre({ ...base, payload: { appointmentId: 'apt_1' } })
  assert.equal(h.event_id, 'wh_1')
  assert.equal(h.source_event_id, 'wh_1')
  assert.equal(h.idempotency_key, 'wh_1')
  assert.equal(h.tenant_id, TENANT_A.id)
  assert.equal(h.raw_event_id, 'raw_1', 'el hecho apunta al sobre del que salió')
})

test('el hecho no lleva datos personales', () => {
  const h = hechoDesdeSobre({
    ...base,
    payload: { appointmentId: 'apt_1', status: 'confirmed', email: 'persona@example.test', firstName: 'Nombre' },
  })
  const serializado = JSON.stringify(h.properties)
  assert.ok(!serializado.includes('example.test'), 'un correo no puede acabar en properties')
  assert.ok(!serializado.includes('Nombre'))
  assert.deepEqual(h.properties, { appointmentId: 'apt_1', status: 'confirmed' })
})

test('los vínculos con persona y cita se guardan cuando se conocen, y null cuando no', () => {
  const con = hechoDesdeSobre({ ...base, payload: {}, contactId: 'c_1', appointmentId: 'a_1' })
  assert.equal(con.contact_id, 'c_1')
  assert.equal(con.appointment_id, 'a_1')
  const sin = hechoDesdeSobre({ ...base, payload: {} })
  assert.equal(sin.contact_id, null)
  assert.equal(sin.appointment_id, null)
})

// ── CORRECCIONES: SE AÑADEN, NO REESCRIBEN ───────────────────────────────────────────────────

test('una corrección es un hecho nuevo que apunta al original', () => {
  const original = hechoDesdeSobre({ ...base, payload: { startTime: '2026-09-22T10:00:00Z' } })
  const correccion = hechoDeCorreccion(original, {
    motivo: 'el normalizador guardaba no-show como programada',
    normalizador: 'ghl-2',
    propiedades: { status: 'no_show' },
  })
  assert.equal(correccion.event_name, 'ghl.cita.registrada.corregido')
  assert.equal(correccion.properties.corrige, original.event_id)
  assert.match(String(correccion.properties.motivo), /no-show/)
  // No pisa al original: son dos filas, con dos identidades distintas.
  assert.notEqual(correccion.event_id, original.event_id)
})

test('corregir NO mueve el hecho en el tiempo', () => {
  // Reinterpretar lo que pasó el martes no lo convierte en algo que pasó hoy: si la fecha cambiara,
  // las métricas del martes cambiarían solas al corregir un parser.
  const original = hechoDesdeSobre({ ...base, payload: { startTime: '2026-09-22T10:00:00Z' } })
  const correccion = hechoDeCorreccion(original, { motivo: 'x', normalizador: 'ghl-2' })
  assert.equal(correccion.occurred_at, original.occurred_at)
})

test('dos correcciones del mismo normalizador son la misma: reprocesar no acumula filas', () => {
  const original = hechoDesdeSobre({ ...base, payload: {} })
  const a = hechoDeCorreccion(original, { motivo: 'x', normalizador: 'ghl-2' })
  const b = hechoDeCorreccion(original, { motivo: 'x', normalizador: 'ghl-2' })
  assert.equal(a.event_id, b.event_id)
})

// ── VOCABULARIO ──────────────────────────────────────────────────────────────────────────────

test('la tabla de vocabulario y el código declaran los MISMOS tipos', () => {
  // Dos listas que se separan es cómo un funnel deja de contar una etapa sin que salte ningún error.
  const sql = leer('supabase/migrations/20260923090000_event_types.sql')
  for (const { nombre } of TIPOS_DE_EVENTO) {
    assert.ok(sql.includes(`'${nombre}'`), `${nombre} no está sembrado en event_types`)
  }
  const sembrados = [...sql.matchAll(/\('(ghl\.[a-z.]+)',/g)].map((m) => m[1])
  assert.deepEqual(sembrados.sort(), TIPOS_DE_EVENTO.map((t) => t.nombre).sort())
})

test('todo tipo que el normalizador puede producir está declarado', () => {
  const posibles = [
    tipoEventoGhl({ event: 'AppointmentCancelled', appointmentId: 'a' }),
    tipoEventoGhl({ event: 'appointment_rescheduled', appointmentId: 'a' }),
    tipoEventoGhl({ appointmentId: 'a' }),
    tipoEventoGhl({ event: 'ContactCreate' }),
    tipoEventoGhl({}),
  ]
  const declarados = new Set(TIPOS_DE_EVENTO.map((t) => t.nombre))
  for (const tipo of posibles) assert.ok(declarados.has(tipo), `${tipo} no está en TIPOS_DE_EVENTO`)
})

// ── EN EL WEBHOOK ────────────────────────────────────────────────────────────────────────────

test('el hecho se escribe solo si el procesado fue bien', () => {
  const bloque = ruta.slice(ruta.indexOf('EL HECHO CANÓNICO'), ruta.indexOf('return NextResponse.json(cuerpo, init)'))
  assert.match(bloque, /if \(!fallo && sobreId\)/)
  assert.match(bloque, /onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true/)
})

test('el sobre queda enlazado con el hecho que salió de él', () => {
  assert.match(ruta, /update\(\{ canonical_event_id: escrito\.id \}\)/)
})

test('un fallo escribiendo el hecho no tumba la ingesta', () => {
  // El sobre ya está guardado: el hecho se puede volver a derivar de él. Perder la cita, no.
  const bloque = ruta.slice(ruta.indexOf('EL HECHO CANÓNICO'), ruta.indexOf('return NextResponse.json(cuerpo, init)'))
  assert.match(bloque, /console\.warn/)
  assert.doesNotMatch(bloque, /throw/)
})
