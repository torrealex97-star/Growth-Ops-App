import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// ATRIBUCIÓN (UTMs, primer y último toque) EN LA SYNC POR PULL DE AGENDAS.
//
// El webhook de Calendly no está configurado: la sync (cron calendly-ghl + botón history-sync)
// es la vía principal por la que entran las citas. 543 citas llegaron SIN UTM aunque 72 de sus
// payloads (invitee.tracking) los traían — la sync no los leía. Estado real del tenant medido
// el 7-oct: 0 de 640 citas con UTM, 0 atribuciones de contacto con UTM (las 183 filas eran
// ghl_import/ghl solo con source).
//
// Invariantes aquí:
//  · La semántica (first-wins, relleno de huecos, toque antiguo no se presenta como último)
//    vive en lib/contacts/atribucion.ts — la sync NO la duplica.
//  · El toque lleva la FECHA REAL de la reserva (invitee.created_at), no la de la pasada.
//  · Las UTMs de la cita entran SOLO si el payload las trae: el spread vacío no toca columnas
//    en re-syncs (idempotencia, misma regla que closer_id).
//  · Un fallo de atribución NO tumba la sync: la cita vale más que su procedencia.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('Calendly: la sync registra el toque del invitee con su fecha real, no la de la pasada', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  const calendly = sync.slice(sync.indexOf('export async function syncCalendly'))
  assert.ok(calendly.length > 0, 'existe syncCalendly')
  assert.match(calendly, /atribuirDesdePayload\(sb, tenantId, contact\.id, invitee/)
  assert.match(calendly, /text\(invitee\.created_at\) \|\| text\(event\.created_at\)/)
  assert.match(calendly, /source: 'calendly'/)
})

test('las UTMs de la cita entran SOLO si el payload las trae: el spread vacío no toca columnas', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  const calendly = sync.slice(sync.indexOf('export async function syncCalendly'))
  // Spread condicional por campo (re-sync idempotente: sin UTMs en el payload, la pasada
  // nunca escribe nulls sobre las que ya había).
  assert.match(calendly, /\(toque\.utmSource \? \{ utm_source: toque\.utmSource \} : \{\}\)/)
  assert.match(calendly, /\(toque\.utmCampaign \? \{ utm_campaign: toque\.utmCampaign \} : \{\}\)/)
  // Y van dentro de values (update + insert comparten payload), no en un segundo update.
  assert.match(calendly, /source: 'calendly',\s*\n\s*\.\.\.utmDeCita,/)
})

test('GHL: la sync también registra el toque del evento si algún día trae UTMs (hoy 0 de 97)', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  const ghl = sync.slice(sync.indexOf('export async function syncGhl'))
  assert.ok(ghl.length > 0, 'existe syncGhl')
  assert.match(ghl, /atribuirDesdePayload\(sb, tenantId, contact\.data\.id, event/)
  assert.match(ghl, /source: 'ghl'/)
})

test('un fallo de atribución NO tumba la sync (la cita vale más que su procedencia)', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  const calendly = sync.slice(sync.indexOf('export async function syncCalendly'))
  const ghl = sync.slice(sync.indexOf('export async function syncGhl'))
  assert.match(calendly, /catch \(e\) \{\s*\n\s*console\.warn\('\[atribucion\]\[calendly\]/)
  assert.match(ghl, /catch \(e\) \{\s*\n\s*console\.warn\('\[atribucion\]\[ghl\]/)
})

test('la semántica first/last vive en el módulo canónico, no duplicada en la sync', () => {
  // El helper delega en registrarToque: relleno de huecos, first-wins y toque antiguo que no
  // se presenta como último — una sola implementación para webhook y sync (las comisiones y
  // el presupuesto se deciden con estos datos; la regla no puede vivir dos veces).
  const atribucion = leer('lib/contacts/atribucion.ts')
  const helper = atribucion.slice(atribucion.indexOf('export async function atribuirDesdePayload'))
  assert.ok(helper.length > 0, 'existe atribuirDesdePayload')
  assert.match(helper, /registrarToque\(sb, tenantId, contactId, toque\)/)
  // El chequeo de "hay datos" es sobre lo que trae el payload, sin el source del proveedor:
  // si no, todo payload sin UTMs produciría un toque vacío con solo source=proveedor.
  assert.match(helper, /toqueTieneDatos\(leido\)/)
  assert.match(helper, /leido\.source \?\? meta\.source/)
})
