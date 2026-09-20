import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCompanyProfile } from '@/lib/contracts/company'
import { applyVars, buildDefaultTerms, generationVars, type ContractTerms } from '@/lib/contracts/terms'
import { sendContractEmail } from '@/lib/email/resend'
import { getTenantConfigWithFallback } from '@/lib/config'
import type { CommissionRule } from '@/lib/types/database'

// CREACIÓN + ENVÍO DEL CONTRATO DE EQUIPO — la lógica de servidor ÚNICA.
//
// Extraída de app/api/[tenant]/evergreen/contracts/team/route.ts para que el
// ALTA de colaboradores (ruta admin de Colaboradores y registro público de
// afiliados) encadene el contrato automáticamente sin duplicar lógica
// (hallazgo E2E 19-sep: el colaborador nacía sin contrato, bloqueado hasta un
// envío manual desde Contratos).
//
// Dos consumidores:
//  · Ruta manual (UI de Contratos/Usuarios): `force: true` — el admin puede
//    reenviar aunque ya exista otro contrato, y las condiciones vienen
//    confirmadas/editadas desde la UI.
//  · Cadena de alta: sin force — dedup (no duplica un contrato ya enviado o
//    firmado) y condiciones por defecto construidas desde la plataforma
//    (buildDefaultTerms: reglas de comisión del rol + fijo del usuario), con
//    el % del perfil de colaborador mandando sobre el global.

type ContratoEquipoResult = {
  ok: boolean
  // enviado: se creó y (si Resend) se envió. ya_enviado: ya hay uno pendiente
  // de firma (no se duplica). ya_firmado: ya existe uno firmado. error: no se
  // pudo crear (con `error` explicándolo).
  estado: 'enviado' | 'ya_enviado' | 'ya_firmado' | 'error'
  contractId?: string
  token?: string
  signUrl?: string
  emailed: boolean
  emailError?: string | null
  memberEmail?: string | null
  personalEmail?: string | null
  error?: string
}

type ContratoEquipoInput = {
  sb: SupabaseClient
  tenantId: string
  userId: string
  createdBy: string | null
  baseUrl: string
  roleKey?: string | null
  roleLabel?: string | null
  templateId?: string | null
  title?: string | null
  terms?: ContractTerms | null
  affiliatePercent?: number | null
  personalEmail?: string | null
  force?: boolean
}

export async function crearContratoEquipo(input: ContratoEquipoInput): Promise<ContratoEquipoResult> {
  const { sb, tenantId, userId, createdBy, baseUrl } = input
  try {
    // `users` no tiene tenant_id: el miembro debe pertenecer a esta subcuenta
    // (mismo guard que la ruta manual) para no generar contratos cruzados.
    const { data: membership } = await sb
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return { ok: false, estado: 'error', emailed: false, error: 'Miembro no encontrado' }

    const { data: member } = await sb
      .from('users')
      .select(
        'id, full_name, email, personal_email, phone, dni, address, start_date, base_salary, default_affiliate_commission_percent'
      )
      .eq('id', userId)
      .maybeSingle()
    if (!member) return { ok: false, estado: 'error', emailed: false, error: 'Miembro no encontrado' }

    // Dedup (solo en la cadena de alta; la ruta manual FUERZA): el último
    // contrato de equipo del usuario en esta subcuenta manda.
    if (!input.force) {
      const { data: previo } = await sb
        .from('contracts')
        .select('id, status, signing_token')
        .eq('kind', 'equipo')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (previo?.status === 'firmado') {
        return {
          ok: true,
          estado: 'ya_firmado',
          contractId: previo.id,
          emailed: false,
          memberEmail: member.email,
          personalEmail: member.personal_email,
        }
      }
      if (previo?.status === 'enviado' && previo.signing_token) {
        return {
          ok: true,
          estado: 'ya_enviado',
          contractId: previo.id,
          signUrl: `${baseUrl}/firmar/${previo.signing_token}`,
          emailed: false,
          memberEmail: member.email,
          personalEmail: member.personal_email,
        }
      }
    }

    // Correo personal: el indicado (normalizado, admite "Nombre <email>") o el
    // ya guardado; si se indica uno nuevo, se persiste para futuros contratos.
    const raw = input.personalEmail?.trim() || null
    const angle = raw?.match(/<([^>]+)>/)
    const providedPersonalEmail = (angle ? angle[1] : raw)?.trim().toLowerCase() || null
    if (providedPersonalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providedPersonalEmail)) {
      return {
        ok: false,
        estado: 'error',
        emailed: false,
        error: `El correo personal "${providedPersonalEmail}" no es válido`,
      }
    }
    const personalEmail = providedPersonalEmail || member.personal_email || null
    if (providedPersonalEmail && providedPersonalEmail !== member.personal_email) {
      await sb.from('users').update({ personal_email: providedPersonalEmail }).eq('id', member.id)
    }

    // Plantilla: la indicada, o la de equipo activa del rol del colaborador
    // (si no hay específica, cualquier activa de equipo de la subcuenta).
    let templateId = input.templateId ?? null
    if (!templateId) {
      const { data: plantillas } = await sb
        .from('contract_templates')
        .select('id, role_key')
        .eq('tenant_id', tenantId)
        .eq('kind', 'equipo')
        .eq('is_active', true)
      const pool = (plantillas ?? []) as { id: string; role_key: string | null }[]
      const roleDeseado = input.roleKey ?? 'affiliate'
      templateId = pool.find((p) => p.role_key === roleDeseado)?.id ?? pool[0]?.id ?? null
    }
    let templateBody = ''
    if (templateId) {
      const { data: tpl } = await sb
        .from('contract_templates')
        .select('body')
        .eq('id', templateId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      templateBody = tpl?.body ?? ''
    }

    // Condiciones: las confirmadas por la UI o las por defecto de la plataforma.
    let terms: ContractTerms
    if (input.terms) {
      terms = input.terms
    } else {
      const { data: rules } = await sb.from('commission_rules').select('*')
      terms = buildDefaultTerms(
        {
          id: member.id,
          base_salary: member.base_salary,
          default_affiliate_commission_percent: member.default_affiliate_commission_percent,
        },
        input.roleKey ?? null,
        input.roleLabel ?? null,
        (rules ?? []) as CommissionRule[]
      )
    }
    // El % configurado en el perfil de colaborador (por subcuenta) manda sobre
    // el global del usuario — es el que el admin vio y confirmó en el alta.
    if (input.affiliatePercent != null) {
      terms = { ...terms, affiliate_percent: input.affiliatePercent }
    }

    const company = await getCompanyProfile(sb, tenantId)
    const finalRoleLabel = input.roleLabel ?? terms.role_label ?? 'Colaborador'

    // Cuerpo: plantilla + variables conocidas (empresa/miembro). Las variables
    // del firmante (dni, dirección…) quedan como placeholder para la 2ª pasada
    // al firmar (sign/[token]).
    const startDate = member.start_date
      ? new Date(member.start_date).toLocaleDateString('es-ES')
      : new Date().toLocaleDateString('es-ES')
    const bodySnapshot = applyVars(
      templateBody,
      generationVars(company, {
        fullName: member.full_name,
        email: member.email,
        personalEmail,
        roleLabel: finalRoleLabel,
        startDate,
        fixedSalary: terms.fixed_salary,
      })
    )

    const token = randomBytes(24).toString('hex')
    const now = new Date().toISOString()
    const finalTitle = input.title?.trim() || `Contrato ${finalRoleLabel} — ${member.full_name}`

    const { data: created, error } = await sb
      .from('contracts')
      .insert({
        kind: 'equipo',
        user_id: member.id,
        template_id: templateId,
        contract_role: finalRoleLabel,
        title: finalTitle,
        status: 'enviado',
        terms: {
          ...terms,
          role_label: finalRoleLabel,
          role_key: input.roleKey ?? terms.role_key ?? null,
          personal_email: personalEmail,
        },
        body_snapshot: bodySnapshot,
        signing_token: token,
        sent_at: now,
        created_by: createdBy,
        tenant_id: tenantId,
      })
      .select('id')
      .single()
    if (error || !created) {
      return { ok: false, estado: 'error', emailed: false, error: error?.message ?? 'No se pudo crear el contrato' }
    }

    const signUrl = `${baseUrl}/firmar/${token}`

    // Envío automático por email (si Resend está configurado y hay correo):
    // empresa con copia (cc) al personal; si solo hay personal, va al personal.
    let emailed = false
    let emailError: string | null = null
    const primary = member.email || personalEmail
    if (primary) {
      const cc = member.email ? personalEmail : null
      const mail = await getTenantConfigWithFallback(tenantId)
      const r = await sendContractEmail({ mail, to: primary, cc, memberName: member.full_name, company, signUrl })
      emailed = r.ok
      emailError = r.ok ? null : (r.error ?? null)
      if (r.ok) await sb.from('contracts').update({ email_sent_at: now }).eq('id', created.id).eq('tenant_id', tenantId)
    }

    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      entity_type: 'contract',
      entity_id: created.id,
      action: 'create',
      new_values: { kind: 'equipo', user_id: member.id, created_by: createdBy, emailed, automatico: !input.force },
    })

    return {
      ok: true,
      estado: 'enviado',
      contractId: created.id,
      token,
      signUrl,
      emailed,
      emailError,
      memberEmail: member.email,
      personalEmail,
    }
  } catch (err) {
    return { ok: false, estado: 'error', emailed: false, error: err instanceof Error ? err.message : String(err) }
  }
}
