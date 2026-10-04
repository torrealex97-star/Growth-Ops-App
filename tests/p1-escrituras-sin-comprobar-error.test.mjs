import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — segunda tanda del barrido de "escrituras sin comprobar { error }" (28-sep),
// hallazgos P1 del informe de auditoría (estado de negocio y rastro de auditoría, no dinero
// directo). Estilo de la casa: invariante estático sobre el fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8').replace(/\/\/[^\n]*/g, '')

test('webhooks/calendly: la reprogramación entrante comprueba el update y responde 500 si falla', () => {
  const src = leer('app/api/[tenant]/evergreen/webhooks/calendly/route.ts')
  assert.match(src, /const \{ error: apptUpdateErr \} = await sb/)
  assert.match(src, /if \(apptUpdateErr\) \{/)
})

test('appointments/cancel: el update de estado comprueba error antes de responder ok', () => {
  const src = leer('app/api/[tenant]/evergreen/appointments/cancel/route.ts')
  assert.match(src, /const \{ error: updateErr \} = await sb/)
  assert.match(src, /if \(updateErr\) \{/)
})

test('appointments/reschedule: activities.insert comprueba { error } en vez de un try/catch inútil', () => {
  const src = leer('app/api/[tenant]/evergreen/appointments/reschedule/route.ts')
  // supabase-js no lanza: no debe quedar ningún try que envuelva el insert de activities.
  assert.ok(!/try \{\s*\n\s*await sb\.from\('activities'\)\.insert/.test(src))
  assert.match(src, /const \{ error: activityErr \} = await sb\.from\('activities'\)\.insert/)
  assert.match(src, /const \{ error: activityErr2 \} = await sb\.from\('activities'\)\.insert/)
})

test('webhooks/onboarding: el click de accesos responde error si el update del contrato falla', () => {
  const src = leer('app/api/[tenant]/evergreen/webhooks/onboarding/route.ts')
  const idxUpdate = src.indexOf('update({ accesos_abiertos_at: now })')
  const idxCheck = src.indexOf('if (error) return NextResponse.json({ error: error.message }, { status: 500 })')
  assert.ok(idxUpdate > -1 && idxCheck > -1 && idxUpdate < idxCheck)
})

test('youtube/backfill: marcar uploaded/failed comprueba error (evita re-subir un Short duplicado)', () => {
  const src = leer('lib/youtube/backfill.ts')
  assert.match(src, /const \{ error: markUploadedErr \} = await sb/)
  assert.match(src, /const \{ error: markFailedErr \} = await sb/)
  assert.match(src, /DUPLICADO/)
})

test('colaboradores/attribution: si el audit_logs del override falla, la respuesta lo dice (no ok:true silencioso)', () => {
  const src = leer('app/api/[tenant]/evergreen/colaboradores/attribution/route.ts')
  const idxInsert = src.indexOf("const { error: auditErr } = await sb.from('audit_logs').insert(")
  const idxCheck = src.indexOf('if (auditErr) {')
  const idxOk = src.indexOf('NextResponse.json({ ok: true, from: anterior, to: collaboratorId })')
  assert.ok(idxInsert > -1 && idxCheck > -1 && idxOk > -1 && idxInsert < idxCheck && idxCheck < idxOk)
})

test('rutas de dinero/auditoría: sales, students, documents, users, tenants — el insert de audit_logs comprueba error', () => {
  const casos = [
    ['app/api/[tenant]/evergreen/sales/complete-reservation/route.ts', 'completionError'],
    ['app/api/[tenant]/evergreen/sales/[id]/route.ts', 'auditErr'],
    ['app/api/[tenant]/evergreen/students/course-access/route.ts', 'auditErr'],
    ['app/api/[tenant]/evergreen/documents/override/route.ts', 'auditErr'],
    ['app/api/[tenant]/evergreen/documents/register/route.ts', 'auditErr'],
    ['app/api/[tenant]/evergreen/users/route.ts', 'auditErr'],
    ['lib/tenants/provision.ts', 'auditErr'],
  ]
  for (const [file, varName] of casos) {
    const src = leer(file)
    assert.match(src, new RegExp(`const \\{ error: ${varName}[0-9]?\\s*\\}\\s*=\\s*await`), file)
    assert.match(src, new RegExp(`if \\(${varName}[0-9]?\\)`), file)
  }
})

test('documents/override y register: el actor va en actor_user_id, no colgado como campo suelto en new_values', () => {
  const override = leer('app/api/[tenant]/evergreen/documents/override/route.ts')
  assert.match(override, /actor_user_id: userId/)
  assert.ok(!override.includes('actor: userId'), 'no debe quedar el campo actor suelto sin comprobar')
})

test('contratos firmados (público, adjuntado, alumno): el audit_logs de la firma comprueba error', () => {
  for (const w of [
    'app/api/public-contracts/sign/[token]/route.ts',
    'app/api/public-contracts/sign-student/[token]/route.ts',
    'app/api/[tenant]/evergreen/contracts/attach/route.ts',
    'app/api/[tenant]/evergreen/contracts/student/route.ts',
  ]) {
    const src = leer(w)
    assert.match(src, /const \{ error: audit(Err|FirmaErr) \}\s*=\s*await sb\.from\('audit_logs'\)/, w)
  }
})
