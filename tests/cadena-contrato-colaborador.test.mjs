import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// ---------------------------------------------------------------------------------------
// LA CADENA DE ALTA DEL COLABORADOR (hallazgo E2E 19-sep). El colaborador nacía sin contrato:
// quedaba bloqueado hasta que alguien lo enviara a mano desde Contratos › Equipo. Ahora el
// ALTA (ruta admin de Colaboradores y registro público de afiliados) encadena el contrato de
// equipo automáticamente y lo deja en 'pending_contract'; FIRMAR es lo que lo activa.
// Toda la lógica vive en UN helper compartido con la ruta manual — no hay duplicación.
// ---------------------------------------------------------------------------------------

test('existe un helper único de contrato de equipo con dedup y envío', () => {
  const src = read('lib/contracts/team-contract.ts')
  assert.match(src, /export async function crearContratoEquipo/)
  // Dedup: no duplica si ya hay uno enviado o firmado (la cadena de alta es idempotente).
  assert.match(src, /'ya_enviado'/)
  assert.match(src, /'ya_firmado'/)
  // Condiciones por defecto desde la plataforma (no hardcoded) y el % del perfil mandando.
  assert.match(src, /buildDefaultTerms/)
  assert.match(src, /input\.affiliatePercent != null/)
  // Envío por email con la plantilla de la empresa + auditoría con sello de automatismo.
  assert.match(src, /sendContractEmail/)
  assert.match(src, /automatico: !input\.force/)
})

test('la ruta manual de contratos delega en el helper sin cambiar su respuesta', () => {
  const src = read('app/api/[tenant]/evergreen/contracts/team/route.ts')
  assert.match(src, /crearContratoEquipo/)
  // El admin FUERZA: puede reenviar aunque ya exista otro contrato.
  assert.match(src, /force: true/)
  // La respuesta que consume la UI se conserva (resendConfigured, signUrl, emailed…).
  assert.match(src, /resendConfigured/)
  assert.match(src, /signUrl: result\.signUrl/)
  // Ya no duplica la lógica de creación (token aleatorio y email viven en el helper).
  assert.doesNotMatch(src, /randomBytes/)
  assert.doesNotMatch(src, /sendContractEmail/)
})

test('el alta admin de colaboradores encadena el contrato y pasa a pending_contract', () => {
  const src = read('app/api/[tenant]/evergreen/colaboradores/route.ts')
  assert.match(src, /crearContratoEquipo/)
  assert.match(src, /roleKey: 'affiliate'/)
  assert.match(src, /pending_contract/)
  // El % que el admin puso en el alta es el que entra en el contrato.
  assert.match(src, /affiliatePercent: body\.defaultCommissionPercent/)
  // El fallo del contrato NO bloquea el alta: queda 'invited' y se puede enviar a mano.
  assert.match(src, /No bloquea el alta/)
})

test('el registro público de afiliados encadena el contrato igual que el alta admin', () => {
  const src = read('app/api/[tenant]/evergreen/afiliados/registro/route.ts')
  assert.match(src, /crearContratoEquipo/)
  assert.match(src, /pending_contract/)
  assert.match(src, /affiliatePercent: commissionPct/)
})

test('el POST de colaboradores define status (regresión #83: el TDZ rompía todo el alta)', () => {
  const src = read('app/api/[tenant]/evergreen/colaboradores/route.ts')
  // La línea eliminada por error en la cadena del contrato — sin ella el POST casca 500.
  assert.match(src, /const status = body\.status && ESTADOS\.includes\(body\.status\) \? body\.status : 'invited'/)
})

test('invitar con rol colaborador crea SU perfil automáticamente (mismo tracking_code)', () => {
  const src = read('app/api/[tenant]/evergreen/invite/route.ts')
  // El perfil nace en la invitación cuando el rol es affiliate.
  assert.match(src, /roleKey === 'affiliate'/)
  assert.match(src, /from\('collaborator_profiles'\)/)
  assert.match(src, /\.insert\(/)
  // Código público = el tracking_code del usuario (los enlaces ?ref= existentes siguen valiendo).
  assert.match(src, /trackingCode \?\?/)
  // Idempotente: comprueba perfil previo antes de insertar.
  assert.match(src, /perfilPrevio/)
})

test('editar un usuario a rol Colaborador también crea su ficha (vía UI de Usuarios)', () => {
  const src = read('app/[tenant]/settings/users/page.tsx')
  assert.match(src, /newRoleKey === 'affiliate'/)
  assert.match(src, /from\('collaborator_profiles'\)/)
  assert.match(src, /perfilPrevio/)
})

test('el rol colaborador accede a SU dashboard (misma app, scope distinto)', () => {
  const src = read('lib/auth/permissions.ts')
  // Sin '/dashboard' en los prefijos de affiliate, el layout expulsaba al colaborador
  // de su propio dashboard (el root redirect manda a /dashboard).
  assert.match(src, /affiliate: \['\/dashboard'/)
})

test('firmar el contrato de equipo ACTIVA al colaborador', () => {
  const src = read('app/api/public-contracts/sign/[token]/route.ts')
  // Solo contratos de equipo (los de alumno no tocan collaborator_profiles).
  assert.match(src, /kind === 'equipo'/)
  // Solo desde estados previos a la firma: las decisiones manuales del admin no se tocan.
  assert.match(src, /\['invited', 'pending_contract'\]/)
  assert.match(src, /status: 'active'/)
})

// ---------------------------------------------------------------------------------------
// INVARIANTE EN LA BD (auditoría 21-sep): la creación del perfil no puede depender de cada
// camino de código. Un trigger garantiza que TODO usuario affiliate tiene ficha, en cada
// subcuenta de la que es miembro, con su tracking_code como código. Así ningún alta (invite,
// edición de rol, import, SQL manual, endpoint futuro) deja un colaborador invisible otra vez.
// ---------------------------------------------------------------------------------------

test('invariante en BD: trigger que crea el perfil de todo affiliate (users y tenant_members)', () => {
  const mig = read('supabase/migrations/20260921190000_collaborator_profile_invariant.sql')
  // Trigger tras INSERT/UPDATE del rol en users + tras INSERT de la pertenencia.
  assert.match(mig, /trg_ensure_collaborator_profile ON public\.users/)
  assert.match(mig, /trg_ensure_collaborator_profile_membership ON public\.tenant_members/)
  // El perfil nace con el tracking_code del usuario como código (enlaces ?ref= intactos).
  assert.match(mig, /UPPER\(COALESCE\(NEW\.tracking_code/)
  assert.match(mig, /UPPER\(COALESCE\(u\.tracking_code/)
  // Idempotente: nunca pisa % ni estado ya gestionados por el admin.
  assert.match(mig, /ON CONFLICT \(tenant_id, user_id\) DO NOTHING/)
  // Backfill único para affiliates históricos sin ficha.
  assert.match(mig, /WHERE r\.key = 'affiliate'/)
})

// ---------------------------------------------------------------------------------------
// ATRIBUCIÓN AUTOMÁTICA DE CONTACTOS GHL (21-sep). El webhook GHL escribe utm_content=código
// siempre, pero collaborator_id solo rellena si el perfil estaba ACTIVO en ese instante: los
// contactos que llegaron antes del alta o durante 'invited' quedaban sin atribuir y exigían
// backfill SQL manual (caso Noelia: 50 contactos a mano). El invariant cierra ese hueco:
// nace/activa/cambia-código un colaborador → sus contactos GHL pendientes se atribuyen solos,
// SIEMPRE respetando first-valid-wins (nunca pisa un colaborador ni un override admin).
// ---------------------------------------------------------------------------------------

test('invariante en BD: los contactos GHL (utm_content=código) se atribuyen solos al nacer/activar el colaborador', () => {
  const mig = read('supabase/migrations/20260921194500_collaborator_ghl_backfill.sql')
  // Núcleo con fill condicional: solo filas SIN colaborador (first-valid-wins).
  assert.match(mig, /attribute_ghl_contacts_for_collaborator/)
  assert.match(mig, /ca\.collaborator_id IS NULL/)
  assert.match(mig, /AND collaborator_id IS NULL/) // guard del UPDATE (carrera)
  // Coincidencia por código insensible a mayúsculas/espacios (utm_content vs perfil).
  assert.match(mig, /upper\(btrim\(coalesce\(ca\.utm_content, ''\)\)\) = v_code/)
  // Se dispara en los tres caminos del invariant de perfiles + al activarse la ficha.
  assert.match(mig, /trg_ghl_backfill_profile ON public\.collaborator_profiles/)
  assert.match(mig, /trg_ghl_backfill_user ON public\.users/)
  assert.match(mig, /trg_ghl_backfill_membership ON public\.tenant_members/)
  // Trazable: cada atribución deja rastro en audit_logs con su vía.
  assert.match(mig, /'ghl_backfill_trigger'/)
  // Backfill único del histórico (caso real: fila de Liset sin atribuir).
  assert.match(mig, /ghl_backfill_migration/)
})
