import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// ---------------------------------------------------------------------------------------------
// LA CADENA DE ALTA DEL COLABORADOR (hallazgo E2E 19-sep). El colaborador nacía sin contrato:
// quedaba bloqueado hasta que alguien lo enviara a mano desde Contratos › Equipo. Ahora el
// ALTA (ruta admin de Colaboradores y registro público de afiliados) encadena el contrato de
// equipo automáticamente y lo deja en 'pending_contract'; FIRMAR es lo que lo activa.
// Toda la lógica vive en UN helper compartido con la ruta manual — no hay duplicación.
// ---------------------------------------------------------------------------------------------

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
