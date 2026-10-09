import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — barrido final de "escrituras sin comprobar { error }" (auditoría del 28-sep,
// cierre del patrón documentado en PENDIENTES.md § Seguridad). 10 hallazgos P0 (dinero/seguridad
// reales, no low-stakes), verificados con lectura de código y migraciones (no acceso a BD en vivo
// en este sandbox). Estilo de la casa: invariante estático sobre el fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8').replace(/\/\/[^\n]*/g, '')

test('atribucion.ts: el relleno de colaborador usa .is(), no .eq() — eq(col, null) es el TEXTO "null" en PostgREST', () => {
  const src = leer('lib/contacts/atribucion.ts')
  assert.match(src, /\.is\('collaborator_id', null\)/)
  assert.ok(!src.includes(".eq('collaborator_id', null)"), 'no debe quedar el .eq(col, null) roto')
})

test('webhooks calendly y ghl: el resultado de registrarToque se comprueba, no se descarta', () => {
  for (const w of [
    'app/api/[tenant]/evergreen/webhooks/calendly/route.ts',
    'app/api/[tenant]/evergreen/webhooks/ghl/route.ts',
  ]) {
    const src = leer(w)
    assert.match(src, /const r = await registrarToque\(/, w)
    assert.match(src, /if \(!r\.ok\)[\s\S]{0,240}status: 500/, w)
  }
})

test('afiliados/registro: ensureTenantMembership devuelve {ok,error} y ambos llamadores lo comprueban', () => {
  const src = leer('app/api/[tenant]/evergreen/afiliados/registro/route.ts')
  assert.match(src, /return \{ ok: !error, error: error\?\.message \}/)
  // Camino de usuario existente: responde error si falla, no un falso "listo".
  const idxExistingCall = src.indexOf('const membership = await ensureTenantMembership(existingId)')
  const idxExistingCheck = src.indexOf('if (!membership.ok) {')
  assert.ok(idxExistingCall > -1 && idxExistingCheck > -1 && idxExistingCall < idxExistingCheck)
  // Camino de usuario nuevo: idem.
  const idxNewCall = src.indexOf('const membership = await ensureTenantMembership(invited.user.id)')
  assert.ok(idxNewCall > idxExistingCheck, 'debe haber una segunda comprobación para el alta nueva')
})

test('afiliados/registro y colaboradores: collaborator_profiles (upsert/insert/update) comprueba error', () => {
  const registro = leer('app/api/[tenant]/evergreen/afiliados/registro/route.ts')
  assert.match(registro, /collabProfileErr/)
  assert.match(registro, /if \(collabProfileErr\)/)
  const colaboradores = leer('app/api/[tenant]/evergreen/colaboradores/route.ts')
  assert.match(colaboradores, /membershipErr/)
  assert.match(colaboradores, /if \(membershipErr\)\s*\n?\s*return NextResponse\.json/)
  assert.match(colaboradores, /estadoErr/)
})

test('invite: el insert de collaborator_profiles comprueba error', () => {
  const src = leer('app/api/[tenant]/evergreen/invite/route.ts')
  assert.match(src, /const \{ error: perfilErr \} = await supabase\.from\('collaborator_profiles'\)\.insert/)
  assert.match(src, /if \(perfilErr\)/)
})

test('firma de contrato de equipo (público y attach): la activación de collaborator_profiles comprueba error', () => {
  for (const w of [
    'app/api/public-contracts/sign/[token]/route.ts',
    'app/api/[tenant]/evergreen/contracts/attach/route.ts',
  ]) {
    const src = leer(w)
    assert.match(src, /const \{ error: activarErr \} = await sb\s*\n\s*\.from\('collaborator_profiles'\)/, w)
    assert.match(src, /if \(activarErr\)/, w)
  }
})

test('contracts/student: si el update del contrato existente falla, no se manda el email con datos viejos', () => {
  const src = leer('app/api/[tenant]/evergreen/contracts/student/route.ts')
  const idxUpdate = src.indexOf(".from('contracts')\n            .update({")
  const idxThrow = src.indexOf('if (updateErr) throw new Error(updateErr.message)')
  assert.ok(idxUpdate > -1 && idxThrow > -1 && idxUpdate < idxThrow)
})

test('ver-como entrar/salir: audit_logs lleva tenant_id (NOT NULL) y el error se comprueba', () => {
  for (const w of [
    'app/api/[tenant]/evergreen/admin/ver-como/entrar/route.ts',
    'app/api/[tenant]/evergreen/admin/ver-como/salir/route.ts',
  ]) {
    const src = leer(w)
    assert.match(src, /tenant_id: tenantRow\?\.id \?\? null/, w)
    assert.match(src, /if \(auditErr\) console\.error/, w)
  }
})

test('erase-person: el audit log de borrado no usa entity_id null (columna NOT NULL) y comprueba error', () => {
  const src = leer('lib/privacidad/erase-person.ts')
  assert.ok(!src.includes('entity_id: null'), 'entity_id no puede ser null: la columna es NOT NULL')
  assert.match(src, /entity_id: informe\.personaHash/)
  assert.match(src, /if \(auditErr\) console\.error/)
})

test('campañas: el upsert de expenses lleva tenant_id (columna NOT NULL) — sin él el gasto de ads nunca llegaba a Gastos', () => {
  const src = leer('app/[tenant]/marketing/adquisicion/campanas/page.tsx')
  const idxFn = src.indexOf('const upsertAdExpense')
  const idxUpsert = src.indexOf("from('expenses').upsert(")
  const idxTenantId = src.indexOf('tenant_id: tenantId,', idxUpsert)
  assert.ok(idxFn > -1 && idxUpsert > idxFn && idxTenantId > idxUpsert && idxTenantId < idxUpsert + 80)
})
