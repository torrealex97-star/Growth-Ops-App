import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const page = readFileSync(join(root, 'app/[tenant]/crm/contactos/[id]/page.tsx'), 'utf8')
const route = readFileSync(join(root, 'app/api/[tenant]/evergreen/colaboradores/attribution/route.ts'), 'utf8')
const tipos = readFileSync(join(root, 'lib/types/database.ts'), 'utf8')

// Petición: "Debo poder atribuirle o quitarle atribucion de leads a los afiliados de forma facil"
// — la ficha del contacto debe permitir asignar/quitar el colaborador llamando al endpoint de
// override administrativo ya existente (auditado, con motivo obligatorio).

test('ContactAttribution incluye collaborator_id (ya existe en la tabla desde la migración 20260918150000)', () => {
  const bloque = tipos.split('export type ContactAttribution = {')[1].split('\n\n')[0]
  assert.match(bloque, /collaborator_id: string \| null/)
})

test('la ficha de contacto carga los colaboradores activos de la subcuenta', () => {
  assert.match(page, /from\('collaborator_profiles'\)/)
  assert.match(page, /\.in\('status', \['active', 'pending_contract'\]\)/)
})

test('el control de atribución está acotado a admin\\/director, igual que el endpoint', () => {
  assert.match(page, /const puedeGestionarAtribucion = sesion\?\.rol === 'admin' \|\| sesion\?\.rol === 'director'/)
  assert.match(route, /\['admin', 'director'\]\.includes\(t\.role/)
})

test('guardar llama al endpoint de override con contactId, collaboratorId y un motivo obligatorio', () => {
  const handler = page.split('const handleGuardarColaborador = async () => {')[1].split('\n  const ')[0]
  assert.match(handler, /colaboradorReason\.trim\(\)/)
  assert.match(handler, /\/api\/\$\{tenant\}\/evergreen\/colaboradores\/attribution/)
  assert.match(handler, /method: 'POST'/)
  assert.match(handler, /contactId: id, collaboratorId, reason: colaboradorReason\.trim\(\)/)
})

test('el selector ofrece quitar la atribución con un valor "Directo \\/ Sin colaborador"', () => {
  assert.match(page, /Directo \/ Sin colaborador/)
  assert.match(page, /colaboradorDraft === '__none__' \? null : colaboradorDraft/)
})

test('el endpoint sigue exigiendo motivo y auditando el cambio (no se duplica la regla en la UI)', () => {
  assert.match(route, /if \(!reason\) return NextResponse\.json/)
  assert.match(route, /entity_type: 'contact_attribution'/)
  assert.match(route, /action: 'collaborator_attribution_override'/)
})
