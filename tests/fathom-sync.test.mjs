import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const INGESTA = 'lib/fathom/ingesta.ts'
const SYNC = 'app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts'
const WEBHOOK = 'app/api/[tenant]/evergreen/webhooks/fathom/route.ts'
// Se comprueba el CÓDIGO, no los comentarios: el archivo explica en prosa qué hacía la versión
// anterior, así que buscar esas palabras en crudo daría falsos positivos.
const code = (p) =>
  read(p)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

// El fallo que esto impide volver a introducir: cuando había varias citas candidatas, la ingesta
// escribía la transcripción en TODAS. Duplicaba la llamada, estampaba el mismo fathom_meeting_id en
// N filas, y el re-sync siguiente parecía idempotente habiendo dejado N-1 filas con una llamada que
// no ocurrió ahí.
test('la ingesta de Fathom nunca escribe en varias citas a la vez', () => {
  const c = code(INGESTA)
  assert.ok(c.includes('procesarMeetingFathom'), 'no se ha localizado la ingesta canónica')
  // El update apunta a UNA cita por id, no a un .in(...) de varias.
  assert.match(c, /\.eq\('id', decision\.appointmentId\)/)
  assert.doesNotMatch(c, /\.in\(\s*'id'/, 'vuelve a escribir en varias citas de golpe')
  // Y no vuelve a existir la ventana de ±12 h como criterio de emparejamiento.
  assert.doesNotMatch(c, /12 \* 60 \* 60 \* 1000[\s\S]{0,200}\.update\(/)
})

test('la decisión la toma el matcher, no la ingesta', () => {
  const c = code(INGESTA)
  assert.match(c, /import \{ decideMatch \} from '@\/lib\/fathom\/match'/)
  assert.match(c, /const decision = decideMatch\(/)
  // Los cuatro resultados posibles se contemplan explícitamente.
  for (const kind of ['ya_importada', 'match', 'ambigua']) {
    assert.match(c, new RegExp(`'${kind}'`), `la ingesta no contempla el caso ${kind}`)
  }
})

test('los casos dudosos van a la cola de revisión, de forma idempotente', () => {
  const c = code(INGESTA)
  assert.match(c, /from\('fathom_match_review'\)/)
  assert.match(c, /onConflict: 'tenant_id,fathom_meeting_id'/, 'el unique debe ser por subcuenta, no global')
  assert.match(c, /ignoreDuplicates: true/)
  // Si ya está en la cola, manda la persona: no se reprocesa.
  assert.match(c, /'ya_en_revision'/)
})

test('la escritura comprueba que afectó a alguna fila', () => {
  const c = code(INGESTA)
  // Un UPDATE bloqueado por RLS afecta a 0 filas SIN error: contarlo como emparejado dejaría la
  // cola avanzando sin que nada cambie en la base.
  assert.match(c, /\.select\('id'\)/)
  assert.match(c, /updated\.length === 0/)
})

test('hay dry-run y no escribe nada', () => {
  const ingesta = code(INGESTA)
  assert.match(ingesta, /dryRun\?: boolean/)
  assert.match(ingesta, /if \(dryRun\) return/)
  assert.match(ingesta, /if \(!dryRun\)/)
  // El dry-run lo pide el botón y lo pasa la ruta.
  const sync = code(SYNC)
  assert.match(sync, /body\.dryRun === true/)
})

// El webhook entrante y el botón de histórico son DOS fuentes de la misma reunión: si cada uno
// tuviera su propia versión del emparejamiento, divergirían (y ya pasó con las citas).
test('el webhook y el histórico usan la MISMA ingesta canónica', () => {
  const sync = code(SYNC)
  const webhook = code(WEBHOOK)
  assert.match(sync, /procesarMeetingFathom\(/)
  assert.match(webhook, /procesarMeetingFathom\(/)
  // El webhook no escribe en citas por su cuenta: la decisión es de la ingesta, nunca suya.
  assert.doesNotMatch(webhook, /from\('appointments'\)/)
  // Y no toca la API de Fathom: el payload ya trae transcripción y resumen.
  assert.doesNotMatch(webhook, /api\.fathom\.ai/)
})

test('el histórico reparte los contadores que devuelve la ingesta', () => {
  const sync = code(SYNC)
  for (const contador of [
    'ya_en_revision\\+\\+',
    'ya_importadas\\+\\+',
    'emparejadas\\+\\+',
    'a_revision_ambiguas\\+\\+',
    'a_revision_sin_candidatos\\+\\+',
  ]) {
    assert.match(sync, new RegExp(contador), `falta contar ${contador.replace(/\\\\/g, '')}`)
  }
})

test('la migración de la cola existe con aislamiento por subcuenta', () => {
  const sql = read('supabase/migrations/20260913130000_fathom_match_review.sql')
  assert.match(sql, /CREATE UNIQUE INDEX fathom_match_review_tenant_meeting_key[\s\S]*tenant_id, fathom_meeting_id/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  assert.match(sql, /auth_tenant_ids\(\)/)
  assert.match(sql, /is_admin_or_director\(\)/)
  // Coherencia: no puede quedar una fila "resuelta" sin decir a qué cita.
  assert.match(sql, /fathom_review_resolution_coherent/)
})
