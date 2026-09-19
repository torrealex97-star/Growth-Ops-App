import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// Plantillas de email por subcuenta: defaults del catálogo, overrides en BD y
// renderizador de variables. Garantiza que sin override el HTML del sistema no
// cambia (los envíos de hoy se ven igual) y que {{variables}} se sustituyen.
// ─────────────────────────────────────────────────────────────────────────────

// Los módulos son TS: se validan por patrón (misma técnica que el resto de la suite).
const catalogo = read('lib/email/templates.ts')
const resend = read('lib/email/resend.ts')
const api = read('app/api/[tenant]/evergreen/settings/email-templates/route.ts')
const panel = read('components/settings/EmailTemplatesPanel.tsx')

test('catálogo: las 8 plantillas del sistema tienen default y esqueleto', () => {
  for (const key of [
    'invite',
    'recovery',
    'contract',
    'contract_signed',
    'student_contract',
    'student_onboarding',
    'student_contract_signed',
    'task_assigned',
  ]) {
    assert.ok(catalogo.includes(`'${key}'`), `falta la clave ${key} en el catálogo`)
  }
  assert.match(catalogo, /DEFAULT_SUBJECTS/, 'faltan asuntos default')
  assert.match(catalogo, /TEMPLATE_SKELETONS/, 'faltan esqueletos editables')
  assert.match(catalogo, /export function defaultBody/, 'falta defaultBody')
  assert.match(catalogo, /export function renderTemplate/, 'falta el renderizador')
})

test('renderizador: {{var}} se sustituye y las desconocidas se vacían (nunca se muestra el literal)', () => {
  assert.match(catalogo, /vars\[name\] \?\? ''/, 'las variables sin valor deben quedar vacías')
  assert.match(catalogo, /\\\{\\\{\\s\*\(\\w\+\)\\s\*\\\}\\\}/, 'patrón de sustitución con espacios tolerados')
})

test('resend.ts: los envíos resuelven la plantilla de la subcuenta y caen al default si no hay', () => {
  assert.match(resend, /resolveTemplate/, 'los send* deben pasar por resolveTemplate')
  assert.match(resend, /from\('email_templates'\)/, 'debe leer la tabla email_templates')
  assert.match(resend, /company\.tenantId/, 'la subcuenta viene en company.tenantId (llamadas sin cambios)')
  // El fallo de lectura de plantilla NO bloquea el envío: try/catch → default.
  assert.match(resend, /catch \{[\s\S]*?default/, 'el error de plantilla debe caer al default')
  // La convención de credenciales se conserva (test integraciones-conectores la aserta).
  assert.match(resend, /mail\?\.RESEND_API_KEY\?\.trim\(\) \|\| process\.env\.RESEND_API_KEY/)
})

test('resend.ts: firma pública de los send* intacta (las 9 llamadas de la app no cambian)', () => {
  for (const fn of [
    'sendInviteEmail',
    'sendRecoveryEmail',
    'sendContractEmail',
    'sendSignedContractEmail',
    'sendStudentContractEmail',
    'sendStudentOnboardingEmail',
    'sendStudentSignedEmail',
    'sendTaskAssignedEmail',
  ]) {
    assert.match(resend, new RegExp(`export async function ${fn}`), `falta ${fn}`)
  }
})

test('API: claves validadas contra el catálogo y auditoría en guardar/restaurar', () => {
  assert.match(api, /KEYS\.has\(key\)/, 'template_key debe validarse contra el catálogo')
  assert.match(api, /from\('audit_logs'\)\.insert/, 'los cambios deben quedar auditados')
  assert.match(api, /expandSkeletonDirectives/, 'los esqueletos se expanden a HTML puro antes de guardar')
  assert.match(api, /onConflict: 'tenant_id,template_key'/, 'upsert por (tenant, plantilla)')
})

test('RLS de email_templates: aislamiento por subcuenta (estándar de la casa, nunca solo-auth)', () => {
  const mig = read('supabase/migrations/20260919210000_email_templates.sql')
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  // Cada policy lleva dimensión de tenant — regla de 20260919110000.
  const policies = mig.match(/CREATE POLICY[\s\S]*?;/g) ?? []
  assert.ok(policies.length >= 4, 'deben crearse las 4 policies (CRUD)')
  for (const p of policies) {
    assert.match(p, /auth_tenant_ids\(\)|is_super_admin/, 'policy sin dimensión de tenant: regla de la casa')
  }
  assert.doesNotMatch(mig, /USING \(true\)/)
})

test('UI: tarjeta Correos en Configuración y editor con vista previa y restaurar', () => {
  const settings = read('app/[tenant]/settings/page.tsx')
  assert.match(settings, /settings\/correos/, 'falta la tarjeta en la rejilla de Configuración')
  assert.match(panel, /Vista previa/)
  assert.match(panel, /restaurar/i)
  assert.match(panel, /\{\{nombre\}\}/, 'el editor documenta las variables')
})
