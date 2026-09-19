// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO Y RENDERIZADO DE PLANTILLAS DE EMAIL
// ─────────────────────────────────────────────────────────────────────────────
// Módulo PURO (sin Node ni Supabase): lo importan el servidor (envíos) y el
// editor de Configuración › Correos (vista previa en el navegador).
//
// Diseño: cada correo del sistema tiene un default (los HTML que antes vivían
// inline en resend.ts) y puede ser sobreescrito por subcuenta (tabla
// email_templates). El renderizador sustituye {{variables}} en asunto y cuerpo.
//
// REGLA DE FALLBACK: si (tenant_id, template_key) no tiene fila → default del
// catálogo. Guardar una fila y luego borrarla = volver al default. Nada se
// rompe si la tabla no existe todavía (los envíos pasan directo al default).

import type { CompanyProfile } from '@/lib/contracts/company'

export type EmailTemplateKey =
  | 'invite'
  | 'recovery'
  | 'contract'
  | 'contract_signed'
  | 'student_contract'
  | 'student_onboarding'
  | 'student_contract_signed'
  | 'task_assigned'

export type EmailVars = {
  company: CompanyProfile
  memberName?: string
  url?: string
  taskTitle?: string
  taskDescription?: string | null
  dueDate?: string | null
  priority?: string | null
  welcome?: string
  landingUrl?: string
}

// ── DEFAULTS (los HTML de resend.ts, variable a variable) ────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Asuntos por plantilla, con variables.
export const DEFAULT_SUBJECTS: Record<EmailTemplateKey, (v: EmailVars) => string> = {
  invite: (v) => `${v.company.name} · Crea tu contraseña para acceder`,
  recovery: (v) => `${v.company.name} · Restablecer contraseña`,
  contract: (v) => `${v.company.name} · Contrato para firmar`,
  contract_signed: (v) => `${v.company.name} · Copia de tu contrato firmado`,
  student_contract: (v) => `${v.company.name} · ¡Bienvenida! Acepta tus condiciones`,
  student_onboarding: (v) => `${v.company.name} · Tus accesos están listos — empieza aquí`,
  student_contract_signed: (v) => `${v.company.name} · Copia de tu contrato firmado`,
  task_assigned: (v) => `${v.company.name} · Nueva tarea: ${v.taskTitle ?? ''}`,
}

export function defaultSubject(key: EmailTemplateKey, vars: EmailVars): string {
  return DEFAULT_SUBJECTS[key](vars)
}

// Documentación de variables que muestra el editor, por plantilla.
export const TEMPLATE_VARIABLES: Record<EmailTemplateKey, { var: string; desc: string }[]> = {
  invite: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del invitado' },
    { var: '{{enlace}}', desc: 'Enlace para crear la contraseña' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  recovery: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{enlace}}', desc: 'Enlace para crear una nueva contraseña' },
  ],
  contract: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del colaborador' },
    { var: '{{enlace}}', desc: 'Enlace para revisar y firmar el contrato' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  contract_signed: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del colaborador' },
    { var: '{{enlace_pdf}}', desc: 'Enlace de descarga del PDF firmado (si hay)' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  student_contract: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del alumno' },
    { var: '{{enlace}}', desc: 'Enlace para aceptar condiciones' },
    { var: '{{bienvenida}}', desc: 'Mensaje de bienvenida configurado' },
  ],
  student_onboarding: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del alumno' },
    { var: '{{enlace}}', desc: 'Enlace a la landing de accesos' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  student_contract_signed: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del alumno' },
    { var: '{{enlace_pdf}}', desc: 'Enlace de descarga del PDF firmado (si hay)' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  task_assigned: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del responsable' },
    { var: '{{tarea}}', desc: 'Título de la tarea' },
    { var: '{{descripcion}}', desc: 'Descripción (si hay)' },
    { var: '{{meta}}', desc: 'Prioridad y fecha de vencimiento' },
    { var: '{{enlace}}', desc: 'Enlace a las tareas' },
  ],
}

// ── BUILDERS HTML (defaults; trasplantados de resend.ts sin cambios visuales) ─

function layout(inner: string, footer?: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:32px">
${inner}
    </div>
    ${footer ? `<p style="text-align:center;font-size:11px;color:#a1a1aa;margin-top:16px">${footer}</p>` : ''}
  </div>
</body></html>`
}

const btn = (url: string, label: string, color = '#18181b') =>
  `<div style="text-align:center;margin:28px 0">
        <a href="${esc(url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">${esc(label)}</a>
      </div>`

const fallbackLink = (url: string, color = '#3b82f6') =>
  `<p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:${color};word-break:break-all">${esc(url)}</span></p>`

export function defaultBody(key: EmailTemplateKey, v: EmailVars): string {
  const company = v.company.name
  const firma = esc(v.company.email_signature || `Un saludo,\n${company}`)
  switch (key) {
    case 'invite':
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Acceso al panel del equipo</p>`,
          `<p style="font-size:15px;line-height:1.6">Hola ${esc(v.memberName ?? '')},</p>`,
          `<p style="font-size:15px;line-height:1.6">Te damos acceso al panel de ${esc(company)}. Para entrar, primero <b>crea tu contraseña</b> pulsando el botón:</p>`,
          btn(v.url ?? '', 'Crear mi contraseña', '#7c3aed'),
          fallbackLink(v.url ?? '', '#7c3aed'),
          `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
          `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${firma}</p>`,
        ].join('\n      '),
        'Este enlace es personal y caduca. Si no esperabas este correo, ignóralo.'
      )
    case 'recovery':
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Restablecer contraseña</p>`,
          `<p style="font-size:15px;line-height:1.6">Has solicitado restablecer tu contraseña. Pulsa el botón para crear una nueva:</p>`,
          btn(v.url ?? '', 'Crear nueva contraseña', '#7c3aed'),
          `<p style="font-size:12px;color:#71717a;line-height:1.6">Si no funciona el botón, copia este enlace:<br><span style="color:#7c3aed;word-break:break-all">${esc(v.url ?? '')}</span></p>`,
          `<p style="font-size:12px;color:#a1a1aa;line-height:1.6;margin-top:16px">Si no fuiste tú, ignora este correo; tu contraseña no cambiará.</p>`,
        ].join('\n      ')
      )
    case 'contract':
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato para firmar</p>`,
          `<p style="font-size:15px;line-height:1.6">Hola ${esc(v.memberName ?? '')},</p>`,
          `<p style="font-size:15px;line-height:1.6">Tienes un contrato listo para revisar y firmar. Podrás completar tus datos (DNI, dirección…) directamente en la página de firma.</p>`,
          btn(v.url ?? '', 'Revisar y firmar contrato'),
          fallbackLink(v.url ?? ''),
          `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
          `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${firma}</p>`,
        ].join('\n      '),
        'Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.'
      )
    case 'contract_signed':
    case 'student_contract_signed':
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato firmado — copia</p>`,
          `<p style="font-size:15px;line-height:1.6">Hola ${esc(v.memberName ?? '')},</p>`,
          `<p style="font-size:15px;line-height:1.6">Tu contrato ha quedado <b>firmado correctamente</b>. Adjuntamos una copia en PDF para tus registros.</p>`,
          v.url ? btn(v.url, 'Descargar contrato firmado') : '',
          `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
          `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${firma}</p>`,
        ]
          .filter(Boolean)
          .join('\n      '),
        'Firma electrónica simple (eIDAS). Conserva esta copia.'
      )
    case 'student_contract':
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Bienvenido a la Academia</p>`,
          `<p style="font-size:16px;line-height:1.6;font-weight:600;color:#7c3aed">${esc(v.welcome ?? '')}</p>`,
          `<p style="font-size:15px;line-height:1.6">Hola ${esc(v.memberName ?? '')}, pulsa el botón para revisar y aceptar las condiciones. En cuanto aceptes, recibirás tus accesos.</p>`,
          btn(v.url ?? '', 'Aceptar condiciones y entrar', '#7c3aed'),
          fallbackLink(v.url ?? '', '#7c3aed'),
        ].join('\n      '),
        'Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.'
      )
    case 'student_onboarding':
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Tus accesos están listos 🚀</p>`,
          `<p style="font-size:16px;line-height:1.6;font-weight:600;color:#7c3aed">¡Ya eres un Winner, ${esc(v.memberName ?? '')}!</p>`,
          `<p style="font-size:15px;line-height:1.6">Hemos activado tus accesos a la Academia. Sigue el paso a paso de onboarding para empezar hoy mismo: ahí encontrarás cómo entrar a la plataforma, el vídeo de inicio y todo lo que necesitas.</p>`,
          btn(v.landingUrl ?? v.url ?? '', 'Ver mis accesos y empezar', '#7c3aed'),
          fallbackLink(v.landingUrl ?? v.url ?? '', '#7c3aed'),
          `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
          `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">${firma}</p>`,
        ].join('\n      ')
      )
    case 'task_assigned': {
      const meta = [v.priority ? `Prioridad: ${esc(v.priority)}` : '', v.dueDate ? `Vence: ${esc(v.dueDate)}` : '']
        .filter(Boolean)
        .join(' · ')
      return layout(
        [
          `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">${esc(company)}</h1>`,
          `<p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Nueva tarea asignada</p>`,
          `<p style="font-size:15px;line-height:1.6">Hola ${esc(v.memberName ?? '')}, tienes una tarea nueva por realizar:</p>`,
          `<div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:10px;padding:16px;margin:16px 0">`,
          `<p style="font-size:15px;font-weight:600;margin:0 0 6px">${esc(v.taskTitle ?? '')}</p>`,
          v.taskDescription
            ? `<p style="font-size:13px;color:#52525b;line-height:1.5;margin:0 0 6px;white-space:pre-line">${esc(v.taskDescription)}</p>`
            : '',
          meta ? `<p style="font-size:12px;color:#a1a1aa;margin:0">${meta}</p>` : '',
          `</div>`,
          `<div style="text-align:center;margin:24px 0">`,
          `<a href="${esc(v.url ?? '')}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:14px;font-weight:600">Ver mis tareas</a>`,
          `</div>`,
        ]
          .filter(Boolean)
          .join('\n      ')
      )
    }
  }
}

// ── ESQUELETOS EDITABLES ─────────────────────────────────────────────────────
// Punto de partida del editor: la misma gramática visual que el default pero con
// {{variables}}. NO se usan en envíos — solo para pre-rellenar el formulario cuando
// la subcuenta aún no ha guardado nada.
export const TEMPLATE_SKELETONS: Record<EmailTemplateKey, { subject: string; body: string }> = {
  invite: {
    subject: '{{empresa}} · Crea tu contraseña para acceder',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Acceso al panel del equipo</p>`,
        `<p style="font-size:15px;line-height:1.6">Hola {{nombre}},</p>`,
        `<p style="font-size:15px;line-height:1.6">Te damos acceso al panel de {{empresa}}. Para entrar, primero <b>crea tu contraseña</b> pulsando el botón:</p>`,
        `{{boton:#7c3aed:Crear mi contraseña}}`,
        `{{enlace_fallback}}`,
        `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
        `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">{{firma}}</p>`,
      ].join('\n      '),
      'Este enlace es personal y caduca. Si no esperabas este correo, ignóralo.'
    ),
  },
  recovery: {
    subject: '{{empresa}} · Restablecer contraseña',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Restablecer contraseña</p>`,
        `<p style="font-size:15px;line-height:1.6">Has solicitado restablecer tu contraseña. Pulsa el botón para crear una nueva:</p>`,
        `{{boton:#7c3aed:Crear nueva contraseña}}`,
        `<p style="font-size:12px;color:#71717a;line-height:1.6">Si no funciona el botón, copia este enlace:<br><span style="color:#7c3aed;word-break:break-all">{{enlace}}</span></p>`,
        `<p style="font-size:12px;color:#a1a1aa;line-height:1.6;margin-top:16px">Si no fuiste tú, ignora este correo; tu contraseña no cambiará.</p>`,
      ].join('\n      ')
    ),
  },
  contract: {
    subject: '{{empresa}} · Contrato para firmar',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato para firmar</p>`,
        `<p style="font-size:15px;line-height:1.6">Hola {{nombre}},</p>`,
        `<p style="font-size:15px;line-height:1.6">Tienes un contrato listo para revisar y firmar.</p>`,
        `{{boton:#18181b:Revisar y firmar contrato}}`,
        `{{enlace_fallback}}`,
        `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
        `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">{{firma}}</p>`,
      ].join('\n      '),
      'Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.'
    ),
  },
  contract_signed: {
    subject: '{{empresa}} · Copia de tu contrato firmado',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato firmado — copia</p>`,
        `<p style="font-size:15px;line-height:1.6">Hola {{nombre}},</p>`,
        `<p style="font-size:15px;line-height:1.6">Tu contrato ha quedado <b>firmado correctamente</b>. Adjuntamos una copia en PDF para tus registros.</p>`,
        `{{boton_pdf}}`,
        `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
        `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">{{firma}}</p>`,
      ].join('\n      '),
      'Firma electrónica simple (eIDAS). Conserva esta copia.'
    ),
  },
  student_contract: {
    subject: '{{empresa}} · ¡Bienvenida! Acepta tus condiciones',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Bienvenido a la Academia</p>`,
        `<p style="font-size:16px;line-height:1.6;font-weight:600;color:#7c3aed">{{bienvenida}}</p>`,
        `<p style="font-size:15px;line-height:1.6">Hola {{nombre}}, pulsa el botón para revisar y aceptar las condiciones. En cuanto aceptes, recibirás tus accesos.</p>`,
        `{{boton:#7c3aed:Aceptar condiciones y entrar}}`,
        `{{enlace_fallback}}`,
      ].join('\n      '),
      'Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.'
    ),
  },
  student_onboarding: {
    subject: '{{empresa}} · Tus accesos están listos — empieza aquí',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Tus accesos están listos 🚀</p>`,
        `<p style="font-size:16px;line-height:1.6;font-weight:600;color:#7c3aed">¡Ya eres parte de {{empresa}}, {{nombre}}!</p>`,
        `<p style="font-size:15px;line-height:1.6">Hemos activado tus accesos. Sigue el paso a paso de onboarding para empezar hoy mismo.</p>`,
        `{{boton:#7c3aed:Ver mis accesos y empezar}}`,
        `{{enlace_fallback}}`,
        `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
        `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">{{firma}}</p>`,
      ].join('\n      ')
    ),
  },
  student_contract_signed: {
    subject: '{{empresa}} · Copia de tu contrato firmado',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 24px;font-size:12px;color:#a1a1aa">Contrato firmado — copia</p>`,
        `<p style="font-size:15px;line-height:1.6">Hola {{nombre}},</p>`,
        `<p style="font-size:15px;line-height:1.6">Tu contrato ha quedado <b>firmado correctamente</b>. Adjuntamos una copia en PDF para tus registros.</p>`,
        `{{boton_pdf}}`,
        `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">`,
        `<p style="font-size:13px;color:#52525b;line-height:1.6;white-space:pre-line">{{firma}}</p>`,
      ].join('\n      '),
      'Firma electrónica simple (eIDAS). Conserva esta copia.'
    ),
  },
  task_assigned: {
    subject: '{{empresa}} · Nueva tarea: {{tarea}}',
    body: layout(
      [
        `<h1 style="margin:0 0 4px;font-size:20px;color:#09090b">{{empresa}}</h1>`,
        `<p style="margin:0 0 20px;font-size:12px;color:#a1a1aa">Nueva tarea asignada</p>`,
        `<p style="font-size:15px;line-height:1.6">Hola {{nombre}}, tienes una tarea nueva por realizar:</p>`,
        `<div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:10px;padding:16px;margin:16px 0">`,
        `<p style="font-size:15px;font-weight:600;margin:0 0 6px">{{tarea}}</p>`,
        `<p style="font-size:13px;color:#52525b;line-height:1.5;margin:0 0 6px;white-space:pre-line">{{descripcion}}</p>`,
        `<p style="font-size:12px;color:#a1a1aa;margin:0">{{meta}}</p>`,
        `</div>`,
        `<div style="text-align:center;margin:24px 0">`,
        `<a href="{{enlace}}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:14px;font-weight:600">Ver mis tareas</a>`,
        `</div>`,
      ].join('\n      ')
    ),
  },
}

// Directivas {{boton:…}}, {{boton_pdf}} y {{enlace_fallback}} de los esqueletos:
// el editor las expande al HTML del botón/enlace antes de guardar, para que la
// plantilla guardada sea HTML puro con {{variables}} simples (lo que renderTemplate
// ya entiende). Así el usuario nunca escribe href a mano.
export function expandSkeletonDirectives(body: string): string {
  return body
    .replace(/\{\{boton:([^:}]+):([^}]+)\}\}/g, (_, color: string, label: string) => btn('{{enlace}}', label, color))
    .replace(/\{\{boton_pdf\}\}/g, btn('{{enlace_pdf}}', 'Descargar contrato firmado'))
    .replace(
      /\{\{enlace_fallback\}\}/g,
      `<p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:#7c3aed;word-break:break-all">{{enlace}}</span></p>`
    )
}

// Variables de MUESTRA para la vista previa del editor (nunca se envían).
export function sampleVars(empresa: string): Record<string, string> {
  return {
    empresa,
    nombre: 'Ana García',
    enlace: 'https://ejemplo.com/enlace',
    enlace_pdf: 'https://ejemplo.com/contrato.pdf',
    bienvenida: 'Bienvenida al programa',
    firma: 'Un saludo,\nEl equipo de ' + empresa,
    tarea: 'Llamada de seguimiento',
    descripcion: 'Contactar con el lead antes de las 18:00.',
    meta: 'Prioridad: Alta · Vence: 30/09',
  }
}

// ── VARIABLES → sustitución ──────────────────────────────────────────────────

// Mapa de variables disponibles para el renderizador. {{firma}} lleva el escape
// YA aplicado cuando viene del default (white-space:pre-line la respeta); desde
// una plantilla guardada llega texto plano y se escapa aquí.
export function templateVars(key: EmailTemplateKey, v: EmailVars): Record<string, string> {
  void key
  return {
    empresa: v.company.name,
    nombre: v.memberName ?? '',
    enlace: v.url ?? '',
    enlace_pdf: v.url ?? '',
    bienvenida: v.welcome ?? '',
    firma: v.company.email_signature || `Un saludo,\n${v.company.name}`,
    tarea: v.taskTitle ?? '',
    descripcion: v.taskDescription ?? '',
    meta: [v.priority ? `Prioridad: ${v.priority}` : '', v.dueDate ? `Vence: ${v.dueDate}` : '']
      .filter(Boolean)
      .join(' · '),
  }
}

// Sustituye {{var}} (con espacios tolerados: {{ var }}). Las variables sin valor
// se dejan VACÍAS (nunca se muestra el literal {{…}} a un destinatario).
export function renderTemplate(source: string, vars: Record<string, string>): string {
  return source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => vars[name] ?? '')
}
