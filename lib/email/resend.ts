import { Resend } from 'resend'
import type { CompanyProfile } from '@/lib/contracts/company'

// Envío de emails con Resend. Requiere RESEND_API_KEY.
// RESEND_FROM: remitente verificado, p.ej. "[tenant] <contratos@tudominio.com>".
// Si no hay dominio verificado, Resend permite pruebas con "onboarding@resend.dev".
export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

function fromAddress(company: CompanyProfile): string {
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM
  // Fallback de pruebas de Resend (sustituir por dominio propio en producción).
  return `${company.name} <onboarding@resend.dev>`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function contractEmailHtml(opts: {
  memberName: string
  companyName: string
  signUrl: string
  signature: string | null
}): string {
  const { memberName, companyName, signUrl, signature } = opts
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(companyName)}</h1>
      <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato para firmar</p>
      <p style="font-size:15px;line-height:1.6">Hola ${esc(memberName)},</p>
      <p style="font-size:15px;line-height:1.6">Tienes un contrato listo para revisar y firmar. Podrás completar tus datos (DNI, dirección…) directamente en la página de firma.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${esc(signUrl)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">Revisar y firmar contrato</a>
      </div>
      <p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:#3b82f6;word-break:break-all">${esc(signUrl)}</span></p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
      <p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${esc(signature || `Un saludo,\n${companyName}`)}</p>
    </div>
    <p style="text-align:center;font-size:11px;color:#a1a1aa;margin-top:16px">Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.</p>
  </div>
</body></html>`
}

function inviteEmailHtml(opts: { fullName: string; companyName: string; url: string; signature: string | null }): string {
  const { fullName, companyName, url, signature } = opts
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(companyName)}</h1>
      <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Acceso al panel del equipo</p>
      <p style="font-size:15px;line-height:1.6">Hola ${esc(fullName)},</p>
      <p style="font-size:15px;line-height:1.6">Te damos acceso al panel de ${esc(companyName)}. Para entrar, primero <b>crea tu contraseña</b> pulsando el botón:</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${esc(url)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">Crear mi contraseña</a>
      </div>
      <p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:#7c3aed;word-break:break-all">${esc(url)}</span></p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
      <p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${esc(signature || `Un saludo,\n${companyName}`)}</p>
    </div>
    <p style="text-align:center;font-size:11px;color:#a1a1aa;margin-top:16px">Este enlace es personal y caduca. Si no esperabas este correo, ignóralo.</p>
  </div>
</body></html>`
}

// Envía el email de invitación (crear contraseña) al nuevo miembro.
export async function sendInviteEmail(opts: {
  to: string
  fullName: string
  company: CompanyProfile
  url: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      subject: `${opts.company.name} · Crea tu contraseña para acceder`,
      html: inviteEmailHtml({ fullName: opts.fullName, companyName: opts.company.name, url: opts.url, signature: opts.company.email_signature }),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía el email de restablecer contraseña (recovery) con plantilla propia.
export async function sendRecoveryEmail(opts: {
  to: string
  company: CompanyProfile
  url: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(opts.company.name)}</h1>
      <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Restablecer contraseña</p>
      <p style="font-size:15px;line-height:1.6">Has solicitado restablecer tu contraseña. Pulsa el botón para crear una nueva:</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${esc(opts.url)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">Crear nueva contraseña</a>
      </div>
      <p style="font-size:12px;color:#71717a;line-height:1.6">Si no funciona el botón, copia este enlace:<br><span style="color:#7c3aed;word-break:break-all">${esc(opts.url)}</span></p>
      <p style="font-size:12px;color:#a1a1aa;line-height:1.6;margin-top:16px">Si no fuiste tú, ignora este correo; tu contraseña no cambiará.</p>
    </div>
  </div>
</body></html>`
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      subject: `${opts.company.name} · Restablecer contraseña`,
      html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function signedContractEmailHtml(opts: {
  memberName: string
  companyName: string
  signature: string | null
  pdfUrl: string | null
}): string {
  const { memberName, companyName, signature, pdfUrl } = opts
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(companyName)}</h1>
      <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato firmado — copia</p>
      <p style="font-size:15px;line-height:1.6">Hola ${esc(memberName)},</p>
      <p style="font-size:15px;line-height:1.6">Tu contrato ha quedado <b>firmado correctamente</b>. Adjuntamos una copia en PDF para tus registros.</p>
      ${pdfUrl ? `<div style="text-align:center;margin:28px 0">
        <a href="${esc(pdfUrl)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">Descargar contrato firmado</a>
      </div>` : ''}
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
      <p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${esc(signature || `Un saludo,\n${companyName}`)}</p>
    </div>
    <p style="text-align:center;font-size:11px;color:#a1a1aa;margin-top:16px">Firma electrónica simple (eIDAS). Conserva esta copia.</p>
  </div>
</body></html>`
}

// Envía una copia del contrato YA FIRMADO (PDF adjunto) al colaborador.
// `to` = correo de empresa; `cc` = correo personal (recibe la misma copia).
export async function sendSignedContractEmail(opts: {
  to: string
  cc?: string | string[] | null
  memberName: string
  company: CompanyProfile
  pdfUrl: string | null
  pdfBytes?: Uint8Array | null
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const norm = (s: string) => s.trim().toLowerCase()
    const to = norm(opts.to)
    const ccList = (Array.isArray(opts.cc) ? opts.cc : opts.cc ? [opts.cc] : [])
      .map((c) => norm(c))
      .filter((c) => c && c !== to)
    const cc = Array.from(new Set(ccList))
    const attachments = opts.pdfBytes
      ? [{ filename: 'contrato-firmado.pdf', content: Buffer.from(opts.pdfBytes) }]
      : undefined
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      ...(cc.length ? { cc } : {}),
      subject: `${opts.company.name} · Copia de tu contrato firmado`,
      html: signedContractEmailHtml({
        memberName: opts.memberName,
        companyName: opts.company.name,
        signature: opts.company.email_signature,
        pdfUrl: opts.pdfUrl,
      }),
      ...(attachments ? { attachments } : {}),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ==================== TAREAS ====================

// Aviso al responsable de que se le ha asignado una tarea nueva.
export async function sendTaskAssignedEmail(opts: {
  to: string
  assigneeName: string
  company: CompanyProfile
  taskTitle: string
  taskDescription?: string | null
  dueDate?: string | null
  priority?: string | null
  url: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const meta = [
      opts.priority ? `Prioridad: ${esc(opts.priority)}` : '',
      opts.dueDate ? `Vence: ${esc(opts.dueDate)}` : '',
    ].filter(Boolean).join(' · ')
    const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(opts.company.name)}</h1>
      <p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Nueva tarea asignada</p>
      <p style="font-size:15px;line-height:1.6">Hola ${esc(opts.assigneeName)}, tienes una tarea nueva por realizar:</p>
      <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:10px;padding:16px;margin:16px 0">
        <p style="font-size:15px;font-weight:600;margin:0 0 6px">${esc(opts.taskTitle)}</p>
        ${opts.taskDescription ? `<p style="font-size:13px;color:#52525b;line-height:1.5;margin:0 0 6px;white-space:pre-line">${esc(opts.taskDescription)}</p>` : ''}
        ${meta ? `<p style="font-size:12px;color:#a1a1aa;margin:0">${meta}</p>` : ''}
      </div>
      <div style="text-align:center;margin:24px 0">
        <a href="${esc(opts.url)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:14px;font-weight:600">Ver mis tareas</a>
      </div>
    </div>
  </div>
</body></html>`
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      subject: `${opts.company.name} · Nueva tarea: ${opts.taskTitle}`,
      html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ==================== ALUMNOS ====================

function studentContractEmailHtml(opts: { studentName: string; companyName: string; signUrl: string; welcome: string }): string {
  const { studentName, companyName, signUrl, welcome } = opts
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(companyName)}</h1>
      <p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Bienvenido a la Academia</p>
      <p style="font-size:16px;line-height:1.6;font-weight:600;color:#7c3aed">${esc(welcome)}</p>
      <p style="font-size:15px;line-height:1.6">Hola ${esc(studentName)}, pulsa el botón para revisar y aceptar las condiciones. En cuanto aceptes, recibirás tus accesos.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${esc(signUrl)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-size:15px;font-weight:700">Aceptar condiciones y entrar</a>
      </div>
      <p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace:<br><span style="color:#7c3aed;word-break:break-all">${esc(signUrl)}</span></p>
    </div>
    <p style="text-align:center;font-size:11px;color:#a1a1aa;margin-top:16px">Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.</p>
  </div>
</body></html>`
}

// Envía al ALUMNO el contrato para aceptar ("Bienvenido Winner…" + enlace cortafuegos).
export async function sendStudentContractEmail(opts: {
  to: string
  studentName: string
  company: CompanyProfile
  signUrl: string
  welcome: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      subject: `${opts.company.name} · ¡Bienvenida! Acepta tus condiciones`,
      html: studentContractEmailHtml({ studentName: opts.studentName, companyName: opts.company.name, signUrl: opts.signUrl, welcome: opts.welcome }),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Landing de onboarding donde el alumno encuentra sus accesos y el paso a paso.
export const ONBOARDING_LANDING_URL =
  process.env.ONBOARDING_LANDING_URL || 'https://tu-dominio.com/onboarding-academia'

function studentOnboardingEmailHtml(opts: { studentName: string; companyName: string; landingUrl: string; signature: string | null }): string {
  const { studentName, companyName, landingUrl, signature } = opts
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
      <h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(companyName)}</h1>
      <p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Tus accesos están listos 🚀</p>
      <p style="font-size:16px;line-height:1.6;font-weight:600;color:#7c3aed">¡Ya eres un Winner, ${esc(studentName)}!</p>
      <p style="font-size:15px;line-height:1.6">Hemos activado tus accesos a la Academia. Sigue el paso a paso de onboarding para empezar hoy mismo: ahí encontrarás cómo entrar a la plataforma, el vídeo de inicio y todo lo que necesitas.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${esc(landingUrl)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-size:15px;font-weight:700">Ver mis accesos y empezar</a>
      </div>
      <p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace:<br><span style="color:#7c3aed;word-break:break-all">${esc(landingUrl)}</span></p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
      <p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${esc(signature || `Un saludo,\n${companyName}`)}</p>
    </div>
  </div>
</body></html>`
}

// Envía al ALUMNO el correo de onboarding con los pasos + enlace a la landing de accesos.
// Se dispara automáticamente cuando el webhook de accesos (GHL) se ha completado.
export async function sendStudentOnboardingEmail(opts: {
  to: string
  studentName: string
  company: CompanyProfile
  landingUrl?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      subject: `${opts.company.name} · Tus accesos están listos — empieza aquí`,
      html: studentOnboardingEmailHtml({
        studentName: opts.studentName,
        companyName: opts.company.name,
        landingUrl: opts.landingUrl || ONBOARDING_LANDING_URL,
        signature: opts.company.email_signature,
      }),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía al ALUMNO la copia (PDF) del contrato firmado.
export async function sendStudentSignedEmail(opts: {
  to: string
  studentName: string
  company: CompanyProfile
  pdfUrl: string | null
  pdfBytes?: Uint8Array | null
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const attachments = opts.pdfBytes ? [{ filename: 'contrato-firmado.pdf', content: Buffer.from(opts.pdfBytes) }] : undefined
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      subject: `${opts.company.name} · Copia de tu contrato firmado`,
      html: signedContractEmailHtml({ memberName: opts.studentName, companyName: opts.company.name, signature: opts.company.email_signature, pdfUrl: opts.pdfUrl }),
      ...(attachments ? { attachments } : {}),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Envía el email del contrato al colaborador. Devuelve {ok, error?}.
// `to` puede ser el correo de empresa; `cc` recibe una copia (p.ej. el correo
// personal del colaborador). Se deduplican y se ignoran vacíos.
export async function sendContractEmail(opts: {
  to: string
  cc?: string | string[] | null
  memberName: string
  company: CompanyProfile
  signUrl: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const norm = (s: string) => s.trim().toLowerCase()
    const to = norm(opts.to)
    const ccList = (Array.isArray(opts.cc) ? opts.cc : opts.cc ? [opts.cc] : [])
      .map((c) => norm(c))
      .filter((c) => c && c !== to)
    const cc = Array.from(new Set(ccList))
    const { error } = await resend.emails.send({
      from: fromAddress(opts.company),
      to: opts.to,
      ...(cc.length ? { cc } : {}),
      subject: `${opts.company.name} · Contrato para firmar`,
      html: contractEmailHtml({
        memberName: opts.memberName,
        companyName: opts.company.name,
        signUrl: opts.signUrl,
        signature: opts.company.email_signature,
      }),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
