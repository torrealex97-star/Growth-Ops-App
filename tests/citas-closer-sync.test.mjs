import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// CLOSER AUTOMÁTICO EN LA SYNC POR PULL DE AGENDAS (3-oct).
//
// El webhook de Calendly/GHL ya asignaba closer, pero la sincronización (cron calendly-ghl y
// botón history-sync) — que es la fuente principal — re-escribía las citas SIN closer y nunca
// asignaba en las nuevas: agenda sin rep, comisiones sin dueño. La identidad del dueño vive en
// el CALENDARIO (Calendly: event_memberships; GHL: assignedUserId del calendario, el evento no
// lo trae). Invariantes aquí: resolución acotada a subcuenta, solo-envía-si-hay-usuario (nunca
// pisa asignación manual) y estampa del calendario GHL para poder mapear/re-mapear.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('la resolución por email es un punto único, acotado a subcuenta y con calendly_email', () => {
  const tracking = leer('lib/tracking.ts')
  const bloque = tracking.slice(tracking.indexOf('export async function resolveUserIdByEmail'))
  assert.match(bloque, /export async function resolveUserIdByEmail/)
  // Delegar el acotado a la subcuenta en firstMemberOf: `users` es GLOBAL.
  assert.match(bloque, /firstMemberOf\(/)
  // El dueño del calendario puede tener un email distinto al de login (cuenta de trabajo).
  assert.match(bloque, /calendly_email/)
  // Normalización del email antes de comparar.
  assert.match(bloque, /toLowerCase/)
  // Escape de comodines LIKE: sin él, ana_perez@x.com también matcheaba ana-perez@x.com (el '_'
  // es comodín de un carácter en ilike) — la agenda y su comisión podían caer en otro usuario.
  assert.match(bloque, /replace\(\/\[\\\\%_\]\/g/)
  // Y sin interpolación en .or(): una coma en el dato rompía la sintaxis de PostgREST.
  assert.doesNotMatch(bloque, /\.or\(/)
  // El webhook de GHL resuelve el email del dueño con la misma disciplina (sin mayúsculas ni
  // comodines): .eq era case-sensitive y un email guardado con mayúsculas no resolvía nunca.
  const ghlWebhook = leer('app/api/[tenant]/evergreen/webhooks/ghl/route.ts')
  assert.match(ghlWebhook, /ilike\('email', patron\)/)
  assert.doesNotMatch(ghlWebhook, /\.eq\('email', email/)
})

test('GHL: el closer sale del dueño del calendario (assignedUserId), no del evento', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  // El evento no trae usuario: la identidad se pide al calendario.
  assert.match(sync, /assignedUserId/)
  assert.match(sync, /\/users\/\$\{encodeURIComponent\(assignedUserId\)\}/)
  // La resolución pasa por el helper canónico (email → usuario de la app).
  assert.match(sync, /resolveUserIdByEmail\(/)
  // El evento lleva el calendario estampado para poder mapear y re-mapear sin backfill.
  assert.match(sync, /ghl_calendar_id: calendarId/)
})

test('Calendly: el closer sale de event_memberships como en el webhook', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  assert.match(sync, /event_memberships/)
  assert.match(sync, /user_email/)
  assert.match(sync, /resolveUserIdByEmail\(sb, ownerEmail, tenantId\)/)
})

test('la sync RELLENA huecos y NUNCA reasigna: closer_id solo si la fila no tenía y hay usuario', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  // Spread condicional doble (la clave no existe → el update/insert no toca la columna) Y
  // condicionado a que la fila no trajera ya un closer: la pasada diaria del cron no puede
  // revertir una corrección manual ni el rep puesto por el webhook (bug del 4-oct: la vía
  // pull reenviaba el dueño del calendario y pisaba la asignación real en cada pasada).
  const envios = sync.match(/\.\.\.\(closerId && !yaTeniaCloser \? \{ closer_id: closerId \} : \{\}\)/g) ?? []
  assert.equal(envios.length, 2, 'GHL y Calendly: rellenar solo si la fila no tenía closer')
  // Para poder decidir, el select de la fila existente trae closer_id (y, desde que la pasada no
  // retrocede una asistencia marcada, también el estado actual).
  assert.match(sync, /select\('id, contact_id, closer_id, status'\)/)
  assert.match(sync, /select\('id, closer_id, status'\)/)
  // Y nunca un closer_id fijo dentro de values.
  assert.doesNotMatch(sync, /^\s+closer_id: /m)
})

test('la backfill del dueño por calendario existe para las citas ya importadas', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  assert.match(sync, /closer-backfill/)
  // La backfill es UPDATE por calendario y NUNCA borra (idempotente, re-ejecutable).
  const bloque = sync.slice(sync.indexOf('closer-backfill'))
  assert.match(bloque, /\.update\(/)
  assert.doesNotMatch(bloque, /\.delete\(/)
})

test('GHL repara el histórico desde assignedUserId aunque el calendario ya no esté activo', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  const inicio = sync.indexOf('export async function backfillCloserGhlDesdePayload')
  const fin = sync.indexOf('export async function backfillCloserCalendly')
  const bloque = sync.slice(inicio, fin)
  assert.ok(inicio > 0, 'existe el backfill desde el payload persistido')
  assert.match(bloque, /raw_payload/)
  assert.match(bloque, /assignedUserId/)
  assert.match(bloque, /resolveUserIdByEmail\(sb, text\(user\.email\), tenantId\)/)
  assert.match(bloque, /\.is\('closer_id', null\)/, 'nunca reasigna una cita ya atribuida')
  const ghl = sync.slice(sync.indexOf('export async function syncGhl'))
  assert.ok(
    ghl.indexOf('backfillCloserGhlDesdePayload') <
      ghl.indexOf("new URL('https://services.leadconnectorhq.com/contacts/')"),
    'la reparación ocurre antes de gastar el presupuesto en listados'
  )
})

test('el deadline gobierna TODAS las llamadas externas, no solo la primera paginación', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  // Reloj antes de CADA llamada externa que puede colarse bajo el corte: entre páginas NO basta —
  // una página puede contener decenas de eventos y cada evento cuesta un fetch (invitees de
  // Calendly; contacto perezoso de GHL) hasta con 15-20 s de presupuesto propio. Comprobado
  // en producción el 3-oct: 504 con la fila del run colgada en 'running' y lo ya leído sin
  // escribir. Es la lección gemela de la sync de pagos Stripe (#277).
  const relojes = sync.match(/opts\.deadlineMs && Date\.now\(\) > opts\.deadlineMs/g) ?? []
  assert.ok(relojes.length >= 6, `se esperaban >=6 comprobaciones de reloj, hay ${relojes.length}`)
  // Concretamente DENTRO del bucle de eventos de Calendly y del de GHL: un corte solo entre
  // páginas permite procesar una página entera después de haberse pasado del budget.
  const calendly = sync.slice(sync.indexOf('export async function syncCalendly'))
  const ghl = sync.slice(sync.indexOf('export async function syncGhl'))
  assert.match(calendly, /for \(const event of body\.collection \?\? \[\]\) \{[\s\S]*?deadlineMs && Date\.now\(\)/)
  assert.match(
    ghl,
    /for \(let eventIndex = firstEvent; eventIndex < events\.length; eventIndex\+\+\) \{[\s\S]*?deadlineMs && Date\.now\(\)/
  )
  // Y en la resolución de dueños de calendario de GHL: varios calendarios × GET /users sin reloj
  // se come el budget sin escribir ni una cita.
  assert.match(ghl, /duenaDeCalendario[\s\S]*?deadlineMs && Date\.now\(\)/)
})

test('la migración crea la columna y su índice parcial, idempotente', () => {
  const files = ['20261003190000_appointments_ghl_calendar_id.sql']
  for (const f of files) {
    const sql = leer(`supabase/migrations/${f}`)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS ghl_calendar_id TEXT/)
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_appointments_ghl_calendar/)
    assert.match(sql, /WHERE ghl_calendar_id IS NOT NULL/)
  }
})
