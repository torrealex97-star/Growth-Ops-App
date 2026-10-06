import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — ventas sin closer cuando el contacto viene de GoHighLevel/Calendly (4-oct).
//
// Síntoma medido en producción: 18 citas de Calendly SIN closer (las más nuevas), una venta real
// (bandeja Stripe) sin closer porque su fallback tomó la cita que aún no tenía dueño, y Claudia
// con 616 citas como closer (la ingesta SÍ la resuelve). Causa estructural: el bucle del cron
// recorre la ventana ASC con corte por presupuesto y siempre repite la misma cabeza antigua —
// la cola nueva no entraba nunca.
//
// El fix no reasigna nada: la resolución por evento (memberships[0] → email → usuario) se queda
// igual; se cachea por email, y una pasada añade un backfill dirigido a la cola sin closer.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sync = read('lib/integrations/citas-sync.ts')

test('la resolución del dueño de Calendly se memoriza por email (no 2 queries por evento)', () => {
  assert.ok(sync.includes('duenaPorEmail'), 'existe el mapa de dueños por email')
  assert.ok(
    sync.includes('duenaPorEmail.set(ownerEmail, await resolveUserIdByEmail(sb, ownerEmail, tenantId))'),
    'el mapa resuelve UNA vez por host y reutiliza'
  )
  // El bucle por evento ya no llama a resolveUserIdByEmail directo (sería el coste viejo):
  // las dos únicas llamadas (bucle + backfill) van siempre tras el guard del mapa.
  const llamadas = sync.match(/await resolveUserIdByEmail\(sb, ownerEmail, tenantId\)/g) || []
  assert.equal(llamadas.length, 2, 'bucle y backfill resuelven solo dentro de la memoización')
  for (const llamada of llamadas) {
    const antes = sync.slice(Math.max(0, sync.indexOf(llamada) - 120), sync.indexOf(llamada))
    assert.ok(antes.includes('duenaPorEmail.has(ownerEmail)'), 'la resolución va tras el guard del mapa')
  }
})

test('la pasada repara la cola de citas de Calendly sin closer (backfill dirigido)', () => {
  assert.ok(sync.includes('export async function backfillCloserCalendly'), 'existe el backfill de Calendly')
  const backfill = sync.slice(sync.indexOf('export async function backfillCloserCalendly'))
  assert.ok(
    backfill.includes(".eq('external_source', 'calendly')") && backfill.includes(".is('closer_id', null)"),
    'solo toca citas de Calendly SIN closer'
  )
  assert.ok(backfill.includes(".is('closer_id', null)"), 'el UPDATE también filtra closer_id null: nunca reasigna')
  assert.ok(backfill.includes(".select('id, external_id, raw_payload')"), 'lee el sobre ya persistido de la cita')
  assert.ok(
    backfill.includes('row.raw_payload?.event') && backfill.includes('storedEvent?.event_memberships'),
    'resuelve primero el dueño desde raw_payload.event.event_memberships'
  )
  const deadline = backfill.indexOf('opts.deadlineMs && Date.now() > opts.deadlineMs')
  const storedOwner = backfill.indexOf('storedEvent?.event_memberships')
  assert.ok(deadline > storedOwner, 'el deadline externo no impide reparar una fila con payload local')
  assert.ok(deadline < backfill.indexOf('const eventoResponse = await fetch'), 'el fallback de red sí respeta el reloj')
  assert.ok(
    sync.includes('await backfillCloserCalendly(sb, tenantId, headers, duenaPorEmail, opts)'),
    'syncCalendly ejecuta el backfill en cada pasada'
  )
})

test('el resultado del cron declara cuántas agendas recuperaron closer', () => {
  const cron = read('app/api/[tenant]/evergreen/cron/calendly-ghl/route.ts')
  assert.equal(
    (cron.match(/closerBackfill: r\.closerBackfill/g) || []).length,
    2,
    'Calendly y GHL exponen el backfill en el historial operativo'
  )
})

test('el cron corta sin gastar la llamada de invitees del evento que no va a procesar', () => {
  const bucle = sync.slice(sync.indexOf("const url = new URL('https://api.calendly.com/scheduled_events')"))
  const guardInvitees = bucle.indexOf('// Reloj ANTES del fetch de invitees')
  const fetchInvitees = bucle.indexOf('const inviteesResponse = await fetch(`${uri}/invitees')
  assert.ok(guardInvitees > 0 && fetchInvitees > guardInvitees, 'el guard de reloj precede al fetch de invitees')
})

test('las protecciones existentes siguen intactas (rellenar huecos, nunca reasignar)', () => {
  const bucleCalendly = sync.slice(sync.indexOf("const url = new URL('https://api.calendly.com/scheduled_events')"))
  assert.ok(
    bucleCalendly.includes('...(closerId && !yaTeniaCloser ? { closer_id: closerId } : {})'),
    'el update del bucle no toca un closer ya asignado'
  )
  assert.ok(bucleCalendly.includes('estadoAlSincronizar'), 'la asistencia marcada nunca retrocede')
})
