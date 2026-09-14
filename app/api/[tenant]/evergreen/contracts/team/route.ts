import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { requireTenant } from '@/lib/auth/requireTenant'
import { applyVars, generationVars, type ContractTerms } from '@/lib/contracts/terms'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendContractEmail, resendConfigured } from '@/lib/email/resend'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

// Crea un contrato de EQUIPO listo para firmar y (si Resend está configurado)
// lo envía automáticamente por email al colaborador con la plantilla de la empresa.
//  · el ROL es seleccionable (roleKey/roleLabel) e independiente del rol del user.
//  · las condiciones (terms) llegan ya confirmadas/editadas desde la UI.
//  · registra quién da el alta (created_by = usuario logueado).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const me = { id: t.userId }

    const {
      userId,
      templateId,
      title,
      terms,
      roleKey,
      roleLabel,
      personalEmail: rawPersonalEmail,
    } = (await req.json()) as {
      userId?: string
      templateId?: string | null
      title?: string
      terms?: ContractTerms
      roleKey?: string | null
      roleLabel?: string | null
      personalEmail?: string | null
    }
    if (!userId || !terms) {
      return NextResponse.json({ error: 'Faltan userId o condiciones (terms)' }, { status: 400 })
    }
    const rawTrimmed = rawPersonalEmail?.trim() || null
    const angle = rawTrimmed?.match(/<([^>]+)>/)
    const providedPersonalEmail = (angle ? angle[1] : rawTrimmed)?.trim().toLowerCase() || null
    if (providedPersonalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providedPersonalEmail)) {
      return NextResponse.json({ error: `El correo personal "${providedPersonalEmail}" no es válido` }, { status: 400 })
    }

    const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // `users` no tiene tenant_id: comprobamos que el miembro pertenece a esta
    // subcuenta vía tenant_members para no poder generar un contrato para un
    // usuario de otro tenant.
    const { data: membership } = await sb
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', t.tenantId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

    const { data: member } = await sb
      .from('users')
      .select('id, full_name, email, personal_email, phone, dni, address, start_date')
      .eq('id', userId)
      .maybeSingle()
    if (!member) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

    // Correo personal a usar: el que se indique manualmente o, si no, el ya
    // guardado en el usuario. Si se indica uno nuevo, se persiste para el futuro.
    const personalEmail = providedPersonalEmail || member.personal_email || null
    if (providedPersonalEmail && providedPersonalEmail !== member.personal_email) {
      await sb.from('users').update({ personal_email: providedPersonalEmail }).eq('id', member.id)
    }

    const company = await getCompanyProfile(sb, t.tenantId)
    const finalRoleLabel = roleLabel ?? terms.role_label ?? 'Colaborador'

    // Cuerpo: plantilla + variables conocidas (empresa/miembro). Las variables del
    // firmante (dni, direccion…) se dejan como placeholder para la 2ª pasada al firmar.
    let templateBody = ''
    if (templateId) {
      const { data: tpl } = await sb
        .from('contract_templates')
        .select('body')
        .eq('id', templateId)
        .eq('tenant_id', t.tenantId)
        .maybeSingle()
      templateBody = tpl?.body ?? ''
    }
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
    const finalTitle = title?.trim() || `Contrato ${finalRoleLabel} — ${member.full_name}`

    const { data: created, error } = await sb
      .from('contracts')
      .insert({
        kind: 'equipo',
        user_id: member.id,
        template_id: templateId ?? null,
        contract_role: finalRoleLabel,
        title: finalTitle,
        status: 'enviado',
        terms: {
          ...terms,
          role_label: finalRoleLabel,
          role_key: roleKey ?? terms.role_key ?? null,
          personal_email: personalEmail,
        },
        body_snapshot: bodySnapshot,
        signing_token: token,
        sent_at: now,
        created_by: me.id,
        tenant_id: t.tenantId,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
    const signUrl = `${base}/firmar/${token}`

    // Envío automático por email (si Resend está configurado y hay email).
    // Se envía al correo de empresa y, si se indicó, copia (cc) al correo personal.
    // Si no hay correo de empresa pero sí personal, el personal pasa a ser el destinatario.
    let emailed = false
    let emailError: string | null = null
    const primary = member.email || personalEmail
    if (primary) {
      const cc = member.email ? personalEmail : null
      const mail = await getTenantConfigWithFallback(t.tenantId)
      const r = await sendContractEmail({ mail, to: primary, cc, memberName: member.full_name, company, signUrl })
      emailed = r.ok
      emailError = r.ok ? null : (r.error ?? null)
      if (r.ok)
        await sb.from('contracts').update({ email_sent_at: now }).eq('id', created.id).eq('tenant_id', t.tenantId)
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      entity_type: 'contract',
      entity_id: created.id,
      action: 'create',
      new_values: { kind: 'equipo', user_id: member.id, created_by: me.id, emailed },
    })

    return NextResponse.json({
      ok: true,
      contractId: created.id,
      token,
      signUrl,
      emailed,
      emailError,
      resendConfigured: resendConfigured(await getTenantConfigWithFallback(t.tenantId)),
      memberEmail: member.email,
      personalEmail,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
