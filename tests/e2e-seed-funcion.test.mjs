import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// INVARIANTES de la edge function canónica de seeds QA (supabase/functions/e2e-seed).
//
// Las funciones temporales qa-seed-* que la precedieron se desplegaban con el token
// pegado en el código y verify_jwt=false: cómodas, pero un residuo activo con escritura
// service-role. Esta prueba fija las reglas de la función canónica para que ninguna
// iteración futura reincida (sin secretos en el código, fail-closed, cleanup quirúrgico
// y escenarios que cubren los flujos QA actuales).

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Prettier puede elegir comillas simples o dobles: se normalizan para que los patrones
// de invariantes no dependan del estilo de formato.
const fuente = readFileSync(join(root, 'supabase', 'functions', 'e2e-seed', 'index.ts'), 'utf8').replaceAll("'", '"')

test('no lleva tokens ni credenciales escritas en el código', () => {
  // El token va por secreto (E2E_SEED_TOKEN); un literal de token de 36 chars hex con
  // guiones en el código es exactamente el error que se quiere prevenir.
  assert.doesNotMatch(
    fuente,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    'parece un token UUID pegado en el código'
  )
  assert.doesNotMatch(
    fuente,
    /(SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY)\s*=\s*["'`]/,
    'una key nunca se asigna literal en el código'
  )
  // La key de servicio se lee SOLO del runtime inyectado.
  assert.match(fuente, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/)
})

test('es fail-closed: sin secreto configurado responde 503 y no ejecuta nada', () => {
  const idx503 = fuente.indexOf('503')
  const idxToken = fuente.indexOf('E2E_SEED_TOKEN')
  assert.ok(idxToken > 0, 'el secreto E2E_SEED_TOKEN debe existir')
  assert.ok(idx503 > idxToken, 'el 503 fail-closed debe evaluarse tras leer el secreto')
  assert.match(fuente, /if \(!token\)/, 'sin token configurado se corta antes de tocar la BD')
  // Nada de seed/status/cleanup puede ejecutarse antes del gate: el gate va antes del try.
  const idxGate = fuente.indexOf('if (!token)')
  const idxTry = fuente.indexOf('try {')
  assert.ok(idxGate > 0 && idxTry > idxGate, 'el gate precede al bloque try con las acciones')
})

test('cubre los tres escenarios QA: comisiones, contratos y gastos', () => {
  for (const escenario of ['comisiones', 'contratos', 'gastos']) {
    assert.ok(fuente.includes(`scenario === "${escenario}"`), `falta el escenario ${escenario}`)
  }
  // Y las tres acciones.
  for (const accion of ['seed', 'status', 'cleanup']) {
    assert.match(fuente, new RegExp(`action === "${accion}"`))
  }
})

test('el seed de comisiones respeta las restricciones reales de la BD', () => {
  // sales.refund_deadline_at es NOT NULL (+15 días, convención del repo).
  assert.match(fuente, /refund_deadline_at/)
  // commissions tiene unique (collection_id, user_id, participant_type): la comisión
  // approved del mes anterior necesita su propio cobro (dos collections, no una).
  const seedComisiones = fuente.slice(
    fuente.indexOf('scenario === "comisiones"'),
    fuente.indexOf('scenario === "contratos"')
  )
  assert.ok(
    (seedComisiones.match(/from\("collections"\)/g) ?? []).length >= 2,
    'el closer no puede tener dos comisiones sobre el MISMO cobro'
  )
})

test('el cleanup por tenant es quirúrgico: escopado a los usuarios marcadores QA', () => {
  // Aunque otro agente esté usando el tenant a la vez, su actividad no se toca: los
  // perfiles/contratos/usuarios se borran SOLO tras filtrar por los user_id QA.
  assert.match(fuente, /misUserIds/)
  const tenantCleanup = fuente.slice(fuente.indexOf('if (body.tenant)')).replaceAll(/\s+/g, '')
  const idxScope = tenantCleanup.indexOf('.in("user_id",misUserIds)')
  assert.ok(idxScope > 0, 'la purga filtra por los usuarios QA de la función')
  // Tras el escopo por user_id QA deben aparecer los borrados de perfiles y contratos
  // (el borrado de contratos por sale_id del bucle de ventas, marcado por email QA del
  // cliente, es anterior y no cuenta: no toca actividad de otros agentes).
  const trasScope = tenantCleanup.slice(idxScope)
  assert.ok(
    trasScope.includes('from("collaborator_profiles").delete()'),
    'perfiles borrados tras el escopo por usuario QA'
  )
  assert.ok(trasScope.includes('from("contracts").delete()'), 'contratos borrados tras el escopo por usuario QA')
})

test('los datos QA llevan marcadores reconocibles (QA Seed / qa-seed-*)', () => {
  assert.match(fuente, /QA Seed/)
  assert.match(fuente, /qa-seed-/)
})

test('el PDF de contratos se purga de Storage antes de borrar las filas', () => {
  const idxPurga = fuente.indexOf('borrarPdfsContratos')
  assert.ok(idxPurga > 0, 'existe el helper de purga de PDFs')
  const cleanup = fuente.slice(fuente.indexOf('action === "cleanup"'))
  assert.match(cleanup, /borrarPdfsContratos/, 'el cleanup usa la purga (evita huérfanos en el bucket)')
})
