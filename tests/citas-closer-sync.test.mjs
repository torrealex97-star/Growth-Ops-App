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

test('la sync NUNCA pisa una asignación: closer_id solo se envía si hay usuario resuelto', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  // Spread condicional (la clave no existe → el update/insert no toca la columna).
  const envios = sync.match(/\.\.\.\(closerId \? \{ closer_id: closerId \} : \{\}\)/g) ?? []
  assert.equal(envios.length, 2, 'GHL y Calendly deben usar el spread condicional (una vez cada uno)')
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

test('la migración crea la columna y su índice parcial, idempotente', () => {
  const files = ['20261003190000_appointments_ghl_calendar_id.sql']
  for (const f of files) {
    const sql = leer(`supabase/migrations/${f}`)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS ghl_calendar_id TEXT/)
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_appointments_ghl_calendar/)
    assert.match(sql, /WHERE ghl_calendar_id IS NOT NULL/)
  }
})
