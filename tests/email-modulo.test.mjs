import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// Módulo de emails: servicio central, historial, webhook idempotente y
// aislamiento multi-tenant. Los módulos TS se validan por patrón (misma
// técnica que el resto de la suite).
// ─────────────────────────────────────────────────────────────────────────────

test('EmailService: única puerta de entrada, sin HTML propio ni credenciales inline', () => {
  const svc = read('lib/email/service.ts')
  // Delega en los send* de resend.ts (provider) — no construye HTML ni llama a api.resend.com
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
    assert.match(svc, new RegExp(fn), `debe delegar en ${fn}`)
  }
  assert.doesNotMatch(svc, /api\.resend\.com/, 'el provider es el único que habla con Resend')
  // Fallback explícito al entorno, nunca silencioso (§26)
  assert.match(svc, /usedGlobalFallback/)
  assert.match(svc, /getTenantConfig/, 'credenciales SOLO desde Integraciones (getTenantConfig)')
  assert.match(svc, /from\('email_messages'\)/, 'todo envío se registra en el historial')
  assert.match(svc, /replyTo/, 'identidad del tenant: reply-to')
})

test('mapper de estados: eventos Resend → estado interno normalizado', () => {
  const svc = read('lib/email/service.ts')
  for (const ev of [
    'email.sent',
    'email.delivered',
    'email.opened',
    'email.clicked',
    'email.bounced',
    'email.complained',
    'email.failed',
  ]) {
    assert.ok(svc.includes(`'${ev}'`), `falta el evento ${ev}`)
  }
  // No retrocede: DELIVERED no vuelve a SENT
  assert.match(svc, /shouldAdvanceStatus/)
  assert.match(svc, /BOUNCED: 5[\s\S]*?FAILED: 5/s)
})

test('webhook: verificación svix fail-closed, idempotente y tenant desde el registro interno', () => {
  const wh = read('app/api/webhooks/resend/route.ts')
  assert.match(wh, /svix-id/, 'cabeceras svix')
  assert.match(wh, /timingSafeEqual/, 'comparación en tiempo constante')
  assert.match(wh, /onConflict: 'provider,provider_event_id'/, 'idempotencia por (provider, event_id)')
  assert.match(wh, /ignoreDuplicates: true/)
  // El tenant SIEMPRE sale de email_messages, jamás del payload del cliente (§19)
  assert.match(wh, /from\('email_messages'\)[\s\S]*?eq\('provider_message_id'/s)
  assert.doesNotMatch(wh, /body\.data\.tenant_id/)
  // Fail-closed sin secreto
  assert.match(wh, /webhook sin verificar/)
})

test('migración: settings + historial + eventos con RLS tenant y constraint de idempotencia', () => {
  const mig = read('supabase/migrations/20260919220000_email_module.sql')
  assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.tenant_email_settings/)
  assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.email_messages/)
  assert.match(mig, /UNIQUE \(provider, provider_event_id\)/)
  // RLS del estándar de la casa en TODAS las policies
  const policies = mig.match(/CREATE POLICY[\s\S]*?;/g) ?? []
  assert.ok(policies.length >= 9, `policies: ${policies.length}`)
  for (const p of policies) {
    assert.match(p, /auth_tenant_ids\(\)|is_super_admin/, 'policy sin dimensión de tenant')
  }
  assert.doesNotMatch(mig, /USING \(true\)/)
  // Estados normalizados con CHECK
  assert.match(mig, /QUEUED','SENT','DELIVERED/)
  // No se guardan credenciales en settings (§4)
  assert.doesNotMatch(mig, /api_key/i)
})

test('API emails: historial filtrable, detalle 404 cross-tenant y prueba sin lógica de negocio', () => {
  const hist = read('app/api/[tenant]/evergreen/emails/route.ts')
  assert.match(hist, /eq\('tenant_id', t\.tenantId\)/, 'historial siempre acotado al tenant')
  assert.match(hist, /isTest: true/, 'la prueba se marca como tal')
  assert.match(hist, /sendEmail\(\{/, 'la prueba pasa por EmailService')
  const detail = read('app/api/[tenant]/evergreen/emails/[id]/route.ts')
  assert.match(detail, /eq\('tenant_id', t\.tenantId\)/, 'detalle acotado al tenant (aislamiento §28)')
  assert.match(detail, /404/, 'email de otro tenant = 404, no 403 (no revelar existencia)')
})

test('UI Emails: tres pestañas, banner de proveedor y prueba sin tocar integraciones', () => {
  const page = read('app/[tenant]/settings/correos/page.tsx')
  for (const tab of ['Configuración', 'Plantillas', 'Historial']) assert.ok(page.includes(tab), `falta pestaña ${tab}`)
  const panel = read('components/settings/EmailSettingsPanel.tsx')
  assert.match(panel, /Resend no está configurado/)
  assert.match(panel, /usingGlobalFallback/, 'el fallback global se muestra, no se calla (§26)')
  const editor = read('components/settings/EmailTemplatesPanel.tsx')
  assert.match(editor, /Enviar prueba/)
  // La API key nunca se muestra en la UI
  assert.doesNotMatch(editor, /RESEND_API_KEY/)
  assert.doesNotMatch(panel, /RESEND_API_KEY/)
})

test('identidad del tenant: dominio del remitente validado contra la integración', () => {
  const api = read('app/api/[tenant]/evergreen/settings/email/route.ts')
  assert.match(api, /providerDomain/, 'compara con el dominio del remitente de Integraciones')
  assert.match(api, /debe usar el dominio de tu integración/, 'mensaje claro al rechazar')
  // No duplica la API key en esta pantalla (§4)
  assert.doesNotMatch(api, /input.*api.?key/i)
})
