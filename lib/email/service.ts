// ─────────────────────────────────────────────────────────────────────────────
// EMAIL SERVICE — única puerta de entrada para enviar emails
// ─────────────────────────────────────────────────────────────────────────────
// Flujo (spec §3/§31): evento de negocio → EmailService.send({ tenantId, key, … })
//   → resuelve identidad del tenant (tenant_email_settings) → plantilla
//   (override en BD o default del catálogo) → provider (Resend via resend.ts)
//   → registra el envío en email_messages (subject/from/error/provider_message_id).
//
// REGLAS:
//  · Las credenciales NO pasan por aquí: salen de Integraciones (tenant config,
//    cifrada) dentro de sendEmailWithResend — única vía al proveedor.
//  · Fallback EXPLÍCITO (§26): si el tenant no tiene clave propia se usa la del
//    entorno y `usedGlobalFallback: true` queda registrado en el historial
//    (error_message) y devuelto al llamador para que la UI lo muestre.
//  · El registro del envío NUNCA rompe el envío: si email_messages falla, el
//    email salió igualmente y se loguea.
//  · Los adjuntos viajan en la llamada (attachments), no dentro de la plantilla.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  sendContractEmail,
  sendInviteEmail,
  sendRecoveryEmail,
  sendSignedContractEmail,
  sendStudentContractEmail,
  sendStudentOnboardingEmail,
  sendStudentSignedEmail,
  sendTaskAssignedEmail,
} from './resend'
import { defaultBody, defaultSubject, templateVars, renderTemplate, expandSkeletonDirectives } from './templates'
import type { EmailTemplateKey, EmailVars } from './templates'
import type { EmailStatus } from './estados'
import { mapResendEventToStatus, shouldAdvanceStatus } from './estados'
import type { CompanyProfile } from '@/lib/contracts/company'

export type EmailAttachment = {
  filename: string
  content: Uint8Array
}

export type EmailSendInput = {
  tenantId: string
  templateKey: EmailTemplateKey
  recipient: string
  recipientName?: string
  cc?: string | string[] | null
  bcc?: string | string[] | null
  url?: string
  welcome?: string
  landingUrl?: string
  task?: { title: string; description?: string | null; dueDate?: string | null; priority?: string | null }
  attachments?: EmailAttachment[]
  pdfUrl?: string | null
  isTest?: boolean
  relatedEntity?: { type: string; id: string } | null
  company: CompanyProfile
}

export type EmailSendResult = {
  ok: boolean
  error?: string
  messageId?: string
  usedGlobalFallback: boolean
}

export type TenantEmailIdentity = {
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
}

function sbAdmin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Identidad de envío del tenant (from/reply-to). La firma vive en company_profile.
export async function getTenantEmailIdentity(sb: SupabaseClient, tenantId: string): Promise<TenantEmailIdentity> {
  const { data } = await sb
    .from('tenant_email_settings')
    .select('from_name, from_email, reply_to_email')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return {
    fromName: data?.from_name ?? null,
    fromEmail: data?.from_email ?? null,
    replyTo: data?.reply_to_email ?? null,
  }
}

// Plantilla resuelta: override del tenant (o default) + enabled=false = apagada.
export async function resolveTenantTemplate(
  sb: SupabaseClient,
  tenantId: string,
  key: EmailTemplateKey,
  vars: EmailVars
): Promise<{ subject: string; html: string; disabled: boolean; disabledError?: string }> {
  const { data } = await sb
    .from('email_templates')
    .select('subject, body_html, enabled')
    .eq('tenant_id', tenantId)
    .eq('template_key', key)
    .maybeSingle()
  if (data && data.enabled === false) {
    return { subject: '', html: '', disabled: true, disabledError: 'Plantilla desactivada en Configuración › Emails' }
  }
  if (data?.subject && data.body_html) {
    const map = templateVars(key, vars)
    map.firma = map.firma.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return { subject: renderTemplate(data.subject, map), html: renderTemplate(data.body_html, map), disabled: false }
  }
  return { subject: defaultSubject(key, vars), html: defaultBody(key, vars), disabled: false }
}

// El id del proveedor llega de los send* (data.id de Resend) y queda en
// provider_message_id: es la clave con la que el webhook asocia los eventos
// de entrega. En fallo no hay id (status FAILED sin provider_message_id).
async function recordMessage(
  sb: SupabaseClient,
  input: EmailSendInput,
  identity: TenantEmailIdentity,
  company: CompanyProfile,
  result: { ok: boolean; error?: string; messageId?: string },
  fromEmail: string,
  subject: string,
  usedGlobalFallback: boolean
): Promise<void> {
  try {
    await sb.from('email_messages').insert({
      tenant_id: input.tenantId,
      template_key: input.templateKey,
      provider_message_id: result.ok ? (result.messageId ?? null) : null,
      to_email: input.recipient,
      cc_json: input.cc ? (Array.isArray(input.cc) ? input.cc : [input.cc]) : null,
      bcc_json: input.bcc ? (Array.isArray(input.bcc) ? input.bcc : [input.bcc]) : null,
      from_email: fromEmail,
      reply_to_email: identity.replyTo,
      subject,
      status: result.ok ? 'SENT' : 'FAILED',
      is_test: input.isTest ?? false,
      related_entity_type: input.relatedEntity?.type ?? null,
      related_entity_id: input.relatedEntity?.id ?? null,
      error_message: result.ok
        ? usedGlobalFallback
          ? 'Enviado con credencial global (fallback) — configura Resend en Integraciones'
          : null
        : (result.error ?? 'Error desconocido'),
      sent_at: result.ok ? new Date().toISOString() : null,
    })
  } catch (e) {
    console.error('[email-service] no se pudo registrar el envío:', e instanceof Error ? e.message : e)
  }
}

// Envío genérico vía el send* correspondiente de resend.ts. Cada función tiene
// su forma; aquí se mapea el input al shape que ya existe (sin duplicar HTML).
async function dispatchByTemplateKey(
  input: EmailSendInput,
  identity: TenantEmailIdentity,
  company: CompanyProfile,
  mail: { RESEND_API_KEY?: string; RESEND_FROM?: string; REPLY_TO?: string }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const common = { mail, to: input.recipient, company }
  switch (input.templateKey) {
    case 'invite':
      return sendInviteEmail({
        ...common,
        fullName: input.recipientName ?? input.recipient,
        url: input.url ?? '',
      } as never)
    case 'recovery':
      return sendRecoveryEmail({ ...common, url: input.url ?? '' } as never)
    case 'contract':
      return sendContractEmail({
        ...common,
        memberName: input.recipientName ?? input.recipient,
        signUrl: input.url ?? '',
        cc: input.cc ?? null,
      } as never)
    case 'contract_signed':
      return sendSignedContractEmail({
        ...common,
        memberName: input.recipientName ?? input.recipient,
        pdfUrl: input.pdfUrl ?? null,
        pdfBytes: input.attachments?.[0]?.content ?? null,
        cc: input.cc ?? null,
      } as never)
    case 'student_contract':
      return sendStudentContractEmail({
        ...common,
        studentName: input.recipientName ?? input.recipient,
        signUrl: input.url ?? '',
        welcome: input.welcome ?? 'Te damos la bienvenida. Revisa y acepta las condiciones para continuar.',
      } as never)
    case 'student_onboarding':
      return sendStudentOnboardingEmail({
        ...common,
        studentName: input.recipientName ?? input.recipient,
        landingUrl: input.landingUrl ?? input.url,
      } as never)
    case 'student_contract_signed':
      return sendStudentSignedEmail({
        ...common,
        studentName: input.recipientName ?? input.recipient,
        pdfUrl: input.pdfUrl ?? null,
        pdfBytes: input.attachments?.[0]?.content ?? null,
      } as never)
    case 'task_assigned':
      return sendTaskAssignedEmail({
        ...common,
        assigneeName: input.recipientName ?? input.recipient,
        taskTitle: input.task?.title ?? 'Tarea',
        taskDescription: input.task?.description ?? null,
        dueDate: input.task?.dueDate ?? null,
        priority: input.task?.priority ?? null,
        url: input.url ?? '',
      } as never)
  }
}

/**
 * Punto de entrada único. Ejemplo:
 *   await sendEmail({ tenantId, templateKey: 'contract_signed', recipient, variables, attachments })
 * Registra en email_messages y devuelve { ok, usedGlobalFallback, error? }.
 */
export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  const sb = sbAdmin()
  const identity = await getTenantEmailIdentity(sb, input.tenantId)

  // Credenciales: SIEMPRE desde Integraciones (integration_settings de ESTE tenant,
  // cifradas — getTenantConfig solo lee la config propia). Fallback explícito al
  // entorno (global) registrado en el historial (§26: nunca silencioso).
  const { getTenantConfig } = await import('@/lib/config')
  const own = await getTenantConfig(input.tenantId, true)
  const mail: { RESEND_API_KEY?: string; RESEND_FROM?: string; REPLY_TO?: string } = {
    RESEND_API_KEY: own.RESEND_API_KEY,
    RESEND_FROM: own.RESEND_FROM,
  }
  let usedGlobalFallback = false
  if (!mail.RESEND_API_KEY) {
    mail.RESEND_API_KEY = process.env.RESEND_API_KEY
    mail.RESEND_FROM = mail.RESEND_FROM ?? process.env.RESEND_FROM
    usedGlobalFallback = true
  }
  // Reply-To del tenant viaja en el sobre de envío (lo consume resend.ts).
  if (identity.replyTo) mail.REPLY_TO = identity.replyTo

  const vars: EmailVars = {
    company: input.company,
    memberName: input.recipientName ?? input.recipient,
    url: input.url,
    welcome: input.welcome,
    landingUrl: input.landingUrl,
    taskTitle: input.task?.title,
    taskDescription: input.task?.description,
    dueDate: input.task?.dueDate,
    priority: input.task?.priority,
  }

  // Plantilla efectiva (para el historial) — el send* interno la vuelve a
  // resolver; el coste es una lectura extra y garantiza registrar el asunto real.
  const tpl = await resolveTenantTemplate(sb, input.tenantId, input.templateKey, vars)
  if (tpl.disabled) {
    return { ok: false, error: tpl.disabledError ?? 'Plantilla desactivada', usedGlobalFallback }
  }

  const result = await dispatchByTemplateKey(input, identity, input.company, mail)
  // dispatchByTemplateKey devuelve el shape de los send* (ok/error/messageId)

  const fromEmail = identity.fromEmail || mail.RESEND_FROM || `${input.company.name} <onboarding@resend.dev>`
  await recordMessage(sb, input, identity, input.company, result, fromEmail, tpl.subject, usedGlobalFallback)

  return { ok: result.ok, error: result.error, messageId: result.messageId, usedGlobalFallback }
}

export { expandSkeletonDirectives, mapResendEventToStatus, shouldAdvanceStatus }
export type { EmailStatus }
