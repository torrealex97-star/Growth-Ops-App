import { Resend } from 'resend'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CompanyProfile } from '@/lib/contracts/company'
import { defaultSubject, defaultBody, templateVars, renderTemplate } from './templates'
import type { EmailTemplateKey, EmailVars } from './templates'

// Envío de emails con Resend. Requiere RESEND_API_KEY.
// RESEND_FROM: remitente verificado, p.ej. "Tu Empresa <contratos@tudominio.com>".
// Si no hay dominio verificado, Resend permite pruebas con "onboarding@resend.dev".
//
// LAS CREDENCIALES SE PASAN (`mail`). Antes se leían solo de `process.env`: la clave que el usuario
// guardaba en Configuración › Integraciones no se usaba nunca —el panel la daba por conectada y los
// correos salían con la del entorno de Vercel, o no salían— y el remitente de una subcuenta podía
// acabar firmando los correos de otra. `process.env` queda como fallback para los flujos públicos
// (firma de contratos por enlace) que no tienen subcuenta resuelta.
//
// IDENTIDAD DE MENSAJE: los send* devuelven `messageId` (el id `re_…` que Resend
// asigna en el momento del envío, `data.id` de la respuesta). EmailService lo
// persiste en email_messages.provider_message_id y el webhook asocia así los
// eventos (delivered/opened/…) con el envío. En fallo no hay id.
// PLANTILLAS: asunto y cuerpo salen de la plantilla de la subcuenta (tabla email_templates,
// editable en Configuración › Correos) o del default del catálogo (lib/email/templates.ts)
// si no hay override. `resolveTemplate` falla en silencio al default: un problema de lectura
// de plantilla nunca debe bloquear un envío.
export type MailEnv = {
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  /** Reply-To opcional del sobre de envío. Lo inyecta EmailService desde la
   *  identidad del tenant (tenant_email_settings) sin tocar cada firma. */
  REPLY_TO?: string
}

function resendKey(mail?: MailEnv): string | undefined {
  return mail?.RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY
}

export function resendConfigured(mail?: MailEnv): boolean {
  return !!resendKey(mail)
}

function fromAddress(company: CompanyProfile, mail?: MailEnv): string {
  const from = mail?.RESEND_FROM?.trim() || process.env.RESEND_FROM
  if (from) return from
  // Fallback de pruebas de Resend (sustituir por dominio propio en producción).
  return `${company.name} <onboarding@resend.dev>`
}

// Cliente de servicio para leer overrides de plantilla. Se crea perezosamente y
// solo si company.tenantId está presente (los flujos públicos también pasan por
// aquí con tenantId resuelto; si no lo llevara, se usa el default directamente).
let sbAdmin: SupabaseClient | null = null
function sbForTemplates(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  if (!sbAdmin) {
    sbAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return sbAdmin
}

type ResolvedTemplate = { subject: string; html: string }

async function resolveTemplate(
  key: EmailTemplateKey,
  company: CompanyProfile,
  vars: EmailVars
): Promise<ResolvedTemplate> {
  const sb = company.tenantId ? sbForTemplates() : null
  if (sb && company.tenantId) {
    try {
      const { data } = await sb
        .from('email_templates')
        .select('subject, body_html')
        .eq('tenant_id', company.tenantId)
        .eq('template_key', key)
        .maybeSingle()
      if (data?.subject && data?.body_html) {
        const map = templateVars(key, vars)
        // firma/description de plantillas guardadas llegan en plano: se escapan al renderizar
        map.firma = escapeHtml(map.firma)
        map.descripcion = escapeHtml(map.descripcion)
        map.bienvenida = escapeHtml(map.bienvenida)
        return { subject: renderTemplate(data.subject, map), html: renderTemplate(data.body_html, map) }
      }
    } catch {
      // tabla ausente (migración pendiente) o error puntual → default
    }
  }
  return { subject: defaultSubject(key, vars), html: defaultBody(key, vars) }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Envíos (firmas sin cambios; las 9 llamadas de la app no se tocan) ────────

// Envía el email de invitación (crear contraseña) al nuevo miembro.
export async function sendInviteEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  fullName: string
  company: CompanyProfile
  url: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const vars: EmailVars = { company: opts.company, memberName: opts.fullName, url: opts.url }
    const tpl = await resolveTemplate('invite', opts.company, vars)
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      subject: tpl.subject,
      html: tpl.html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía el email de restablecer contraseña (recovery) con plantilla propia.
export async function sendRecoveryEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  company: CompanyProfile
  url: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const tpl = await resolveTemplate('recovery', opts.company, { company: opts.company, url: opts.url })
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      subject: tpl.subject,
      html: tpl.html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía una copia del contrato YA FIRMADO (PDF adjunto) al colaborador.
// `to` = correo de empresa; `cc` = correo personal (recibe la misma copia).
export async function sendSignedContractEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  cc?: string | string[] | null
  memberName: string
  company: CompanyProfile
  pdfUrl: string | null
  pdfBytes?: Uint8Array | null
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const vars: EmailVars = { company: opts.company, memberName: opts.memberName, url: opts.pdfUrl ?? undefined }
    const tpl = await resolveTemplate('contract_signed', opts.company, vars)
    const norm = (s: string) => s.trim().toLowerCase()
    const to = norm(opts.to)
    const ccList = (Array.isArray(opts.cc) ? opts.cc : opts.cc ? [opts.cc] : [])
      .map((c) => norm(c))
      .filter((c) => c && c !== to)
    const cc = Array.from(new Set(ccList))
    const attachments = opts.pdfBytes
      ? [{ filename: 'contrato-firmado.pdf', content: Buffer.from(opts.pdfBytes) }]
      : undefined
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      ...(cc.length ? { cc } : {}),
      subject: tpl.subject,
      html: tpl.html,
      ...(attachments ? { attachments } : {}),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ==================== TAREAS ====================

// Aviso al responsable de que se le ha asignado una tarea nueva.
export async function sendTaskAssignedEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  assigneeName: string
  company: CompanyProfile
  taskTitle: string
  taskDescription?: string | null
  dueDate?: string | null
  priority?: string | null
  url: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const tpl = await resolveTemplate('task_assigned', opts.company, {
      company: opts.company,
      memberName: opts.assigneeName,
      url: opts.url,
      taskTitle: opts.taskTitle,
      taskDescription: opts.taskDescription,
      dueDate: opts.dueDate,
      priority: opts.priority,
    })
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      subject: tpl.subject,
      html: tpl.html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ==================== ALUMNOS ====================

// Envía al ALUMNO el contrato para aceptar ("Bienvenido Winner…" + enlace cortafuegos).
export async function sendStudentContractEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  studentName: string
  company: CompanyProfile
  signUrl: string
  welcome: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const tpl = await resolveTemplate('student_contract', opts.company, {
      company: opts.company,
      memberName: opts.studentName,
      url: opts.signUrl,
      welcome: opts.welcome,
    })
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      subject: tpl.subject,
      html: tpl.html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Landing de onboarding donde el alumno encuentra sus accesos y el paso a paso.
const ONBOARDING_LANDING_URL = process.env.ONBOARDING_LANDING_URL || ''

// Envía al ALUMNO el correo de onboarding con los pasos + enlace a la landing de accesos.
// Se dispara automáticamente cuando el webhook de accesos (GHL) se ha completado.
export async function sendStudentOnboardingEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  studentName: string
  company: CompanyProfile
  landingUrl?: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const tpl = await resolveTemplate('student_onboarding', opts.company, {
      company: opts.company,
      memberName: opts.studentName,
      url: opts.landingUrl || ONBOARDING_LANDING_URL,
    })
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      subject: tpl.subject,
      html: tpl.html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía al ALUMNO la copia (PDF) del contrato firmado.
export async function sendStudentSignedEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  studentName: string
  company: CompanyProfile
  pdfUrl: string | null
  pdfBytes?: Uint8Array | null
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const vars: EmailVars = { company: opts.company, memberName: opts.studentName, url: opts.pdfUrl ?? undefined }
    const tpl = await resolveTemplate('student_contract_signed', opts.company, vars)
    const attachments = opts.pdfBytes
      ? [{ filename: 'contrato-firmado.pdf', content: Buffer.from(opts.pdfBytes) }]
      : undefined
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      subject: tpl.subject,
      html: tpl.html,
      ...(attachments ? { attachments } : {}),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía el email del contrato al colaborador. Devuelve {ok, error?}.
// `to` puede ser el correo de empresa; `cc` recibe una copia (p.ej. el correo
// personal del colaborador). Se deduplican y se ignoran vacíos.
export async function sendContractEmail(opts: {
  /** Credenciales de la subcuenta; si no se pasan, se usa el entorno del despliegue. */
  mail?: MailEnv
  to: string
  cc?: string | string[] | null
  memberName: string
  company: CompanyProfile
  signUrl: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!resendConfigured(opts.mail)) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(resendKey(opts.mail))
    const vars: EmailVars = { company: opts.company, memberName: opts.memberName, url: opts.signUrl }
    const tpl = await resolveTemplate('contract', opts.company, vars)
    const norm = (s: string) => s.trim().toLowerCase()
    const to = norm(opts.to)
    const ccList = (Array.isArray(opts.cc) ? opts.cc : opts.cc ? [opts.cc] : [])
      .map((c) => norm(c))
      .filter((c) => c && c !== to)
    const cc = Array.from(new Set(ccList))
    const { data, error } = await resend.emails.send({
      from: fromAddress(opts.company, opts.mail),
      ...(opts.mail?.REPLY_TO ? { reply_to: opts.mail.REPLY_TO } : {}),
      to: opts.to,
      ...(cc.length ? { cc } : {}),
      subject: tpl.subject,
      html: tpl.html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, messageId: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
