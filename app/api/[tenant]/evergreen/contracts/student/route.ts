import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { requireTenant } from '@/lib/auth/requireTenant'
import { applyVars } from '@/lib/contracts/terms'
import { studentGenerationVars, DEFAULT_STUDENT_WELCOME, type StudentContractTerms } from '@/lib/contracts/student'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendStudentContractEmail, resendConfigured } from '@/lib/email/resend'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

function service() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Elige la plantilla de alumno/tomador para un método de pago concreto.
// Prioridad: (kind + payment_method exacto) → (kind + payment_method NULL, por defecto) → (kind, la más reciente).
async function pickTemplate(
  sb: SupabaseClient,
  kind: 'alumno' | 'tomador',
  paymentMethod: string | null,
  tenantId: string
) {
  const { data: rows } = await sb
    .from('contract_templates')
    .select('id, body, welcome_message, payment_method')
    .eq('kind', kind)
    .eq('is_active', true)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  const list = (rows ?? []) as {
    id: string
    body: string
    welcome_message: string | null
    payment_method: string | null
  }[]
  if (!list.length) return null
  if (paymentMethod) {
    const exact = list.find((t) => (t.payment_method ?? '').toLowerCase() === paymentMethod.toLowerCase())
    if (exact) return exact
  }
  return list.find((t) => !t.payment_method) ?? list[0]
}

// Métodos de pago que implican financiación (el pagador queda "enganchado" y debe
// firmar). En full pay no hace falta firma del pagador → menos fricción.
const FINANCING_METHODS = ['sequra', 'autofinanciado', 'custom']

// Destinatario por defecto del contrato cuando el comprador es un tomador distinto:
//  - financiación → 'ambos' (el pagador debe firmar por obligación de pago)
//  - full pay     → 'alumno' (basta el alumno; no molestamos al pagador)
function defaultRecipient(paymentMethod: string | null, hasDistinctPayer: boolean): 'alumno' | 'ambos' {
  if (!hasDistinctPayer) return 'alumno'
  return FINANCING_METHODS.includes((paymentMethod ?? '').toLowerCase()) ? 'ambos' : 'alumno'
}

// GET ?saleId= — estado de los contratos (alumno + tomador) de una venta.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const saleId = new URL(req.url).searchParams.get('saleId')
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const sb = service()
    const cols =
      'id, status, signing_token, read_at, signed_at, signed_pdf_url, accesos_enviados_at, accesos_abiertos_at, onboarding_webhook_ok, email_sent_at, is_reservation, contract_party'
    const { data } = await sb
      .from('contracts')
      .select(cols)
      .eq('sale_id', saleId)
      .eq('kind', 'venta')
      .eq('tenant_id', t.tenantId)
      .not('signing_token', 'is', null)
      .order('created_at', { ascending: false })

    // Tracking de onboarding (vive en la venta): agendó sesión + fecha de la sesión.
    // También datos para el selector de destinatario del contrato.
    const { data: saleRow } = await sb
      .from('sales')
      .select(
        'onboarding_scheduled_at, onboarding_session_at, onboarding_date, buyer_is_scheduler, payer_data, payment_method, payment_plans(method)'
      )
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()

    const payer = (saleRow?.payer_data ?? null) as { name?: string } | null
    const hasDistinctPayer = saleRow?.buyer_is_scheduler === false && !!payer?.name
    const salePaymentMethod =
      (saleRow?.payment_method as string | null) ??
      (saleRow?.payment_plans as { method?: string | null } | null)?.method ??
      null
    const recommendedRecipient = defaultRecipient(salePaymentMethod, hasDistinctPayer)

    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
    const rows = (data ?? []) as Record<string, unknown>[]
    const withUrl = (r: Record<string, unknown> | undefined) =>
      r ? { ...r, signUrl: `${base}/firmar-alumno/${r.signing_token}` } : null
    const alumno = withUrl(rows.find((r) => (r.contract_party ?? 'alumno') === 'alumno'))
    // El onboarding solo aplica al contrato del alumno (no al del tomador).
    const contract = alumno
      ? {
          ...alumno,
          onboarding_scheduled_at: saleRow?.onboarding_scheduled_at ?? null,
          onboarding_session_at: saleRow?.onboarding_session_at ?? null,
          onboarding_date: saleRow?.onboarding_date ?? null,
        }
      : null
    const payerContract = withUrl(rows.find((r) => r.contract_party === 'tomador'))
    return NextResponse.json({
      contract,
      payerContract,
      hasDistinctPayer,
      recommendedRecipient,
      payerName: payer?.name ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// Crea (o reutiliza) los contratos ligados a una venta con token de firma y —si se
// pide— los envía por email. Genera SIEMPRE el contrato del alumno; y, cuando el
// comprador es un TOMADOR distinto (buyer_is_scheduler=false), también el suyo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const me = { id: t.userId }

    const {
      saleId,
      send = true,
      recipient: rawRecipient,
    } = (await req.json()) as {
      saleId?: string
      send?: boolean
      recipient?: 'alumno' | 'tomador' | 'ambos'
    }
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const sb = service()
    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
    const signUrlFor = (token: string) => `${base}/firmar-alumno/${token}`

    // Venta + relaciones necesarias.
    const { data: sale } = await sb
      .from('sales')
      .select(
        'id, contact_id, gross_amount, payment_method, custom_plan, installments_count, buyer_is_scheduler, payer_data, products(name, duration_months), payment_plans(name, method), contacts(full_name, email, phone, ghl_contact_id)'
      )
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    // La verificación de identidad está pospuesta. La generación del contrato no se bloquea
    // por documents_verified: si el contrato ya se firmó fuera, se adjunta desde la UI.

    const contact = (sale.contacts ?? {}) as { full_name?: string; email?: string | null; phone?: string | null }
    const product = (sale.products ?? {}) as { name?: string; duration_months?: number | null }
    const plan = (sale.payment_plans ?? {}) as { name?: string | null; method?: string | null }
    const studentName = contact.full_name || 'Alumno'
    const studentEmail = contact.email?.trim() || null

    const paymentMethod = (sale.payment_method as string | null) ?? plan.method ?? null
    const isReservation = paymentMethod === 'reserva'
    const company = await getCompanyProfile(sb, t.tenantId)

    const custom = (sale.custom_plan ?? null) as StudentContractTerms['custom']
    const terms: StudentContractTerms = {
      product_name: product.name || 'Programa',
      duration_months: product.duration_months ?? null,
      gross_amount: Number(sale.gross_amount) || 0,
      currency: 'EUR',
      payment_method: paymentMethod,
      plan_name: plan.name ?? null,
      installments_count: sale.installments_count ?? null,
      custom: custom ?? null,
    }
    const dateStr = new Date().toLocaleDateString('es-ES')
    const nowIso = new Date().toISOString()

    // Crea o refresca un contrato de la venta (party = alumno | tomador).
    const upsertContract = async (opts: {
      party: 'alumno' | 'tomador'
      signerName: string
      signerEmail: string | null
      tpl: { id: string; body: string; welcome_message: string | null } | null
    }) => {
      const bodySnapshot = applyVars(
        opts.tpl?.body ?? '',
        studentGenerationVars(company, { fullName: opts.signerName, email: opts.signerEmail, terms, dateStr })
      )
      const title =
        opts.party === 'tomador'
          ? `Contrato de tomador — ${terms.product_name}`
          : isReservation
            ? `Contrato de reserva — ${terms.product_name}`
            : `Contrato de alumno — ${terms.product_name}`

      const { data: existing } = await sb
        .from('contracts')
        .select('id, signing_token, status')
        .eq('sale_id', saleId)
        .eq('kind', 'venta')
        .eq('contract_party', opts.party)
        .eq('tenant_id', t.tenantId)
        .not('signing_token', 'is', null)
        .order('created_at', { ascending: false })
        .maybeSingle()

      let contractId: string
      let token: string
      if (existing) {
        contractId = existing.id
        token = existing.signing_token as string
        if (existing.status !== 'firmado') {
          await sb
            .from('contracts')
            .update({
              title,
              template_id: opts.tpl?.id ?? null,
              terms,
              body_snapshot: bodySnapshot,
              is_reservation: isReservation,
              contract_party: opts.party,
              status: send ? 'enviado' : 'pendiente',
              sent_at: send ? nowIso : null,
            })
            .eq('id', contractId)
            .eq('tenant_id', t.tenantId)
        }
      } else {
        token = randomBytes(24).toString('hex')
        const { data: created, error } = await sb
          .from('contracts')
          .insert({
            kind: 'venta',
            sale_id: saleId,
            contact_id: sale.contact_id,
            template_id: opts.tpl?.id ?? null,
            title,
            status: send ? 'enviado' : 'pendiente',
            terms,
            body_snapshot: bodySnapshot,
            is_reservation: isReservation,
            contract_party: opts.party,
            signing_token: token,
            sent_at: send ? nowIso : null,
            created_by: me.id,
            tenant_id: t.tenantId,
          })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        contractId = created.id
      }
      return { contractId, token, signUrl: signUrlFor(token) }
    }

    // ── Contrato del ALUMNO ──
    const studentTpl = await pickTemplate(sb, 'alumno', paymentMethod, t.tenantId)
    const welcome = studentTpl?.welcome_message || DEFAULT_STUDENT_WELCOME
    const studentContract = await upsertContract({
      party: 'alumno',
      signerName: studentName,
      signerEmail: studentEmail,
      tpl: studentTpl,
    })

    let emailed = false
    let emailError: string | null = null
    if (send && studentEmail) {
      const r = await sendStudentContractEmail({
        mail: await getTenantConfigWithFallback(t.tenantId),
        to: studentEmail,
        studentName,
        company,
        signUrl: studentContract.signUrl,
        welcome,
      })
      emailed = r.ok
      emailError = r.ok ? null : (r.error ?? null)
      if (r.ok)
        await sb
          .from('contracts')
          .update({ email_sent_at: nowIso })
          .eq('id', studentContract.contractId)
          .eq('tenant_id', t.tenantId)
    }

    // ── Contrato del TOMADOR (si el comprador es distinto del agendador) ──
    const payer = (sale.payer_data ?? null) as { name?: string; email?: string | null } | null
    const hasDistinctPayer = sale.buyer_is_scheduler === false && !!payer?.name
    // El closer puede forzar a quién se envía; si no, se decide por método de pago.
    const recipient = rawRecipient ?? defaultRecipient(paymentMethod, hasDistinctPayer)
    const includePayer = hasDistinctPayer && recipient !== 'alumno'
    let payerContract: { contractId: string; token: string; signUrl: string } | null = null
    let payerEmailed = false
    if (includePayer) {
      const payerTpl = await pickTemplate(sb, 'tomador', paymentMethod, t.tenantId)
      const payerEmail = payer!.email?.trim() || null
      payerContract = await upsertContract({
        party: 'tomador',
        signerName: payer!.name!,
        signerEmail: payerEmail,
        tpl: payerTpl,
      })
      if (send && payerEmail) {
        const rp = await sendStudentContractEmail({
          mail: await getTenantConfigWithFallback(t.tenantId),
          to: payerEmail,
          studentName: payer!.name!,
          company,
          signUrl: payerContract.signUrl,
          welcome:
            payerTpl?.welcome_message ||
            'Estás a punto de aceptar las condiciones como tomador/pagador de la formación.',
        })
        payerEmailed = rp.ok
        if (rp.ok)
          await sb
            .from('contracts')
            .update({ email_sent_at: nowIso })
            .eq('id', payerContract.contractId)
            .eq('tenant_id', t.tenantId)
      }
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      entity_type: 'contract',
      entity_id: studentContract.contractId,
      action: 'create',
      new_values: {
        kind: 'venta',
        sale_id: saleId,
        emailed,
        recipient,
        payer: !!payerContract,
        payerEmailed,
        is_reservation: isReservation,
        created_by: me.id,
      },
    })

    return NextResponse.json({
      ok: true,
      contractId: studentContract.contractId,
      token: studentContract.token,
      signUrl: studentContract.signUrl,
      emailed,
      emailError,
      isReservation,
      recipient,
      payer: payerContract ? { signUrl: payerContract.signUrl, emailed: payerEmailed } : null,
      resendConfigured: resendConfigured(await getTenantConfigWithFallback(t.tenantId)),
      studentEmail,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
