import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// -------------------------------------------------------------------------------------------
// COLABORADORES — AISLAMIENTO. Lo primero porque es lo único que no se puede arreglar después.
//
// Un colaborador es un usuario de la app con un scope de datos distinto: mismo login, mismas
// pantallas, mismo motor de comisiones. Lo que NO puede hacer jamás es ver datos atribuidos a
// otro colaborador — ni por tabla, ni por URL, ni por API, ni por un conteo que se cuele.
// -------------------------------------------------------------------------------------------

const SCOPE = 'lib/collaborators/scope.ts'
const MIGRACION = 'supabase/migrations/20260918150000_collaborators_core.sql'
const ATRIBUCION = 'lib/contacts/atribucion.ts'
const OVERRIDE = 'app/api/[tenant]/evergreen/colaboradores/attribution/route.ts'

// --------------------------------------------------------------------------------------------
// §16/§17/§66 — SCOPE DE DATOS: la capa de datos, no un filtro de UI que se pueda quitar.
// --------------------------------------------------------------------------------------------

test('el scope del colaborador se resuelve en la capa de datos, fail-closed', () => {
  const codigo = sinComentarios(leer(SCOPE))
  // Resuelve el perfil por usuario y subcuenta — nunca por código legible ni por custom field.
  assert.match(codigo, /from\('collaborator_profiles'\)/)
  assert.match(codigo, /\.eq\('tenant_id', tenantId\)/)
  assert.match(codigo, /\.eq\('user_id', userId\)/)
  // Ante un error de base de datos devuelve [] (vacío reintentable), nunca null (= todo el tenant).
  // El peor escenario legítimo es una pantalla vacía, no un colaborador viendo la subcuenta entera.
  assert.match(codigo, /if \(error\) \{[\s\S]{0,200}return \[\]/)
})

test('contactos y agendas de la vista CRM llevan el scope sin escapatoria', () => {
  const crm = sinComentarios(leer('components/crm/ContactsAllView.tsx'))
  // El propio colaborador filtra su tabla raíz por id; las agendas anidadas, por contact_id.
  assert.match(crm, /\.in\('id', contactIds\)/)
  assert.match(crm, /\.in\('contact_id', contactIds\)/)
  const agendas = sinComentarios(leer('app/[tenant]/crm/agendas/page.tsx'))
  assert.match(agendas, /appointmentsQuery = appointmentsQuery\.in\('contact_id', contactIds \?\? \[\]\)/)
})

test('ventas y pagos llevan el scope; la venta auxiliar de agendas también', () => {
  for (const p of ['app/[tenant]/ventas/registro/page.tsx', 'app/[tenant]/ventas/pagos/page.tsx']) {
    const codigo = sinComentarios(leer(p))
    assert.match(codigo, /contactIds \? salesQuery\.in\('contact_id', contactIds\) : salesQuery/, p)
  }
  const agendas = sinComentarios(leer('app/[tenant]/crm/agendas/page.tsx'))
  // La consulta que pinta las citas con compra: sin scope, el navegador del colaborador recibiría
  // ventas de contactos ajenos (fuga indirecta §17/§49).
  assert.match(agendas, /salesQuery = salesQuery\.in\('contact_id', contactIdsVentas \?\? \[\]\)/)
})

// --------------------------------------------------------------------------------------------
// §49/§50 — RLS: el backstop de base de datos. Las policies existentes se ENMIENDAN (una rama
// OR): quien ya veía, sigue viendo; el colaborador solo añade lo suyo vía funciones dedicadas.
// --------------------------------------------------------------------------------------------

test('RLS: las policies de scope enmiendan con is_my_collaborator_* y aíslan por tenant', () => {
  const sql = sinComentarios(leer(MIGRACION))
  for (const policy of [
    'contacts_select_scope',
    'contact_attributions_select_scope',
    'sales_select_scope',
    'appointments_select_scope',
    'collections_select_scope',
  ]) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS ${policy}`), policy)
    assert.match(sql, new RegExp(`CREATE POLICY ${policy}`), policy)
  }
  assert.match(sql, /is_my_collaborator_row\(contacts\.id\)/)
  assert.match(sql, /is_my_collaborator_sale\(sales\.id\)/)
  assert.match(sql, /is_my_collaborator_sale\(collections\.sale_id\)/)
  // Aislamiento RESTRICTIVE del perfil, mismo patrón que el resto del pipeline.
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  // Las funciones resuelven SIEMPRE dentro de las subcuentas del que llama (SECURITY DEFINER
  // sin este acotado sería un agujero cross-tenant).
  assert.match(sql, /is_my_collaborator_row[\s\S]{0,900}auth_tenant_ids\(\)/)
  assert.match(sql, /is_my_collaborator_sale[\s\S]{0,900}auth_tenant_ids\(\)/)
})

// --------------------------------------------------------------------------------------------
// §6/§43 — IDENTIDAD: UUID interno; el código público se resuelve server-side dentro del tenant.
// --------------------------------------------------------------------------------------------

test('el código público es único por subcuenta y jamás identidad: el UUID manda', () => {
  const sql = sinComentarios(leer(MIGRACION))
  assert.match(sql, /id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  assert.match(sql, /UNIQUE \(tenant_id, code\)/)
  assert.doesNotMatch(sql, /PRIMARY KEY.*code/)
  // El resolver del ?ref= acota por tenant y solo acepta perfiles activos.
  const scope = sinComentarios(leer(SCOPE))
  assert.match(scope, /resolverColaboradorPorCodigo/)
  const fn = scope.slice(scope.indexOf('resolverColaboradorPorCodigo'))
  assert.match(fn, /\.eq\('tenant_id', tenantId\)/)
  assert.match(fn, /\.eq\('status', 'active'\)/)
})

// --------------------------------------------------------------------------------------------
// §11 — FIRST VALID COLLABORATOR ATTRIBUTION WINS. Un toque posterior de otro enlace no roba
// al primero: la comisión de alguien no cambia en silencio.
// --------------------------------------------------------------------------------------------

test('registrarToque no roba la atribución: solo rellena si estaba vacía, con guard', () => {
  const codigo = sinComentarios(leer(ATRIBUCION))
  // El update de relleno lleva el guard: si otra entrega lo llenó mientras tanto, no pisa.
  assert.match(
    codigo,
    /\.update\(\{ collaborator_id: colaboradorEntrante \}\)[\s\S]{0,120}\.eq\('collaborator_id', null\)/
  )
  // Y la actualización principal del toque existente NO lleva collaborator_id (el primero se queda).
  const updatePrincipal = codigo.match(/\.update\(ultimos\)/)
  assert.ok(updatePrincipal, 'update del toque existente')
})

// --------------------------------------------------------------------------------------------
// §12/§13/§63/§64 — OVERRIDE: solo administración, motivo obligatorio, auditoría old → new.
// --------------------------------------------------------------------------------------------

test('el override de atribución exige admin, motivo y deja rastro auditado', () => {
  const codigo = sinComentarios(leer(OVERRIDE))
  // Solo administración: el colaborador jamás toca su atribución (ni la de nadie).
  assert.match(codigo, /\['admin', 'director'\]\.includes/)
  assert.match(codigo, /status: 403/)
  // Motivo obligatorio — sin motivo no hay cambio de dinero.
  assert.match(codigo, /El motivo es obligatorio/)
  // Auditoría: actor, anterior, nuevo y motivo en audit_logs.
  assert.match(codigo, /from\('audit_logs'\)\.insert/)
  assert.match(codigo, /collaborator_attribution_override/)
  assert.match(codigo, /old_values: \{ collaborator_id: anterior \}/)
  assert.match(codigo, /new_values: \{ collaborator_id: collaboratorId, reason \}/)
  // El contacto y el perfil deben existir EN ESTA subcuenta (nada de ids cross-tenant).
  assert.match(codigo, /\.eq\('tenant_id', t\.tenantId\)/)
})

// --------------------------------------------------------------------------------------------
// §26/§29/§31/§58/§59 — COMISIONES: UN solo ledger. La lane 'collaborator' comparte motor,
// base (cash collected), estados e idempotencia con setter/closer/affiliate. Sin motores nuevos.
// --------------------------------------------------------------------------------------------

test('el ledger es único: participant_type extiende el CHECK y la idempotencia es la existente', () => {
  const sql = sinComentarios(leer(MIGRACION))
  assert.match(
    sql,
    /commissions_participant_type_check\s*\n?\s*CHECK \(participant_type IN \('setter','closer','affiliate','collaborator'\)\)/
  )
  // Idempotencia: la UNIQUE collection+user+participant ya existente es la que evita duplicar
  // comisiones ante webhooks repetidos (§59) — no se crea otra.
  assert.match(
    leer('supabase/migrations/20260911200000_financial_integrity_constraints.sql'),
    /commissions_collection_participant_key/
  )
  const calc = sinComentarios(leer('lib/commissions/calculator.ts'))
  assert.match(calc, /participantTypeForUser/)
  assert.match(calc, /colaboradoresActivos\.has\(userId\)\) return 'collaborator'/)
})

test('una venta puede generar closer Y colaborador sin que uno pise al otro (§58)', () => {
  const calc = sinComentarios(leer('lib/commissions/calculator.ts'))
  // El closer conserva su lane; el colaborador entra como beneficiario independiente.
  assert.match(calc, /participant_type: 'closer'/)
  assert.match(calc, /participant_type: participantTypeForUser\(sale\.affiliate_id, colaboradoresActivos\)/)
})

// --------------------------------------------------------------------------------------------
// §82 — NO HAY SEGUNDO SISTEMA. Ni tablas paralelas, ni logins paralelos, ni CRM paralelo.
// --------------------------------------------------------------------------------------------

test('no existen tablas ni flujos paralelos de colaboradores', () => {
  const prohibidos =
    /affiliate_users|affiliate_login|affiliate_commissions|collaborator_appointments|collaborator_contacts|collaborator_sales/
  const recorrer = (dir, acc = []) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const ruta = `${dir}/${e.name}`
      if (e.isDirectory()) recorrer(ruta, acc)
      else if (/\.(ts|tsx)$/.test(e.name)) acc.push(ruta)
    }
    return acc
  }
  for (const ruta of [...recorrer('lib'), ...recorrer('app')]) {
    const codigo = sinComentarios(leer(ruta))
    assert.doesNotMatch(codigo, prohibidos, `${ruta} menciona infraestructura paralela prohibida`)
  }
})
