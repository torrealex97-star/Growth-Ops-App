import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { generateCommissionsForCollection, saleNeedsCommissionReview } from '@/lib/commissions/generate'
import type { Collection, Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// Marca una cuota como pagada / morosa / normal. Solo admin/director/cobros.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { installmentId, action } = await req.json()
    if (!installmentId || !['paid', 'delinquent', 'unflag'].includes(action)) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: inst, error: instErr } = await sb
      .from('sale_expected_installments')
      .select('*')
      .eq('id', installmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (instErr || !inst) return NextResponse.json({ error: 'Cuota no encontrada' }, { status: 404 })

    if (action === 'paid') {
      // Idempotencia: si la cuota ya está cobrada o ya tiene un cobro asociado (no revertido),
      // NO creamos otro. Evita el doble cobro por doble clic / doble submit (bug de cobros
      // duplicados: la misma cuota generaba 2 collections + 2 comisiones idénticas).
      const { data: existingColl } = await sb
        .from('collections')
        .select('id')
        .eq('expected_installment_id', installmentId)
        .eq('tenant_id', t.tenantId)
        .neq('status', 'reversed')
        .limit(1)
      if (inst.status === 'collected' || (existingColl && existingColl.length > 0)) {
        // Asegura que la cuota queda marcada como cobrada, pero sin duplicar el cobro.
        if (inst.status !== 'collected') {
          await sb
            .from('sale_expected_installments')
            .update({ status: 'collected', flagged_delinquent: false })
            .eq('id', installmentId)
        }
        return NextResponse.json({ ok: true, status: 'collected', already: true, commissionsGenerated: 0 })
      }

      // Cuota de monitorización (p.ej. alumno→Sequra): NO es cash nuestro.
      // Solo marcamos que el alumno pagó a la financiera; sin collection ni comisión.
      if (inst.is_monitoring) {
        await sb
          .from('sale_expected_installments')
          .update({ status: 'collected', flagged_delinquent: false })
          .eq('id', installmentId)
        return NextResponse.json({ ok: true, status: 'collected', monitoring: true })
      }
      const now = new Date().toISOString()
      // Coste de plataforma de esta cuota (fee_percent del plan de pago)
      const { data: saleRow } = await sb
        .from('sales')
        .select('payment_plans(fee_percent, method)')
        .eq('id', inst.sale_id)
        .single()
      const plan = saleRow?.payment_plans as { fee_percent?: number; method?: string | null } | null
      const feePercent = Number(plan?.fee_percent ?? 0)
      const processingFee = Number(inst.expected_gross_amount || 0) * (feePercent / 100)

      // Plan personalizado: solo el primer pago que adelanta el cliente comisiona al instante.
      // Si esta venta ya tiene un cobro elegible previo (reserva/entrada u otra cuota ya aprobada),
      // esta cuota se registra pero queda en REVISIÓN manual de cobros: no genera comisión real
      // hasta que el equipo la apruebe (ver /api/${tenant}/evergreen/collections/approve-review).
      const needsReview = await saleNeedsCommissionReview(sb, t.tenantId, inst.sale_id, plan?.method)

      // Registrar el cobro
      const { data: newCollection, error: collErr } = await sb
        .from('collections')
        .insert({
          tenant_id: t.tenantId,
          sale_id: inst.sale_id,
          expected_installment_id: inst.id,
          collected_at: now,
          gross_amount: inst.expected_gross_amount,
          commissionable_amount: inst.expected_commissionable_amount,
          processing_fee: processingFee,
          is_confirmed: true,
          is_eligible_for_commission: !needsReview,
          eligible_at: needsReview ? null : now,
          needs_commission_review: needsReview,
          payment_channel: 'online',
          status: 'collected',
          recovered: inst.status === 'overdue' || inst.flagged_delinquent,
          recovered_at: inst.status === 'overdue' || inst.flagged_delinquent ? now.slice(0, 10) : null,
        })
        .select()
        .single()
      if (collErr) {
        // 23505 = violación de collections_installment_active_key (UNIQUE parcial en
        // expected_installment_id) — dos requests casi simultáneas para la misma cuota (doble
        // clic, retry de red). La que pierde la carrera no es un error real: la cuota ya quedó
        // cobrada por la otra, así que respondemos igual que la rama de idempotencia de arriba
        // en vez de devolver un 500 que confundiría a quien reintentó por buena fe.
        if (collErr.code === '23505') {
          await sb
            .from('sale_expected_installments')
            .update({ status: 'collected', flagged_delinquent: false })
            .eq('id', installmentId)
          return NextResponse.json({ ok: true, status: 'collected', already: true, commissionsGenerated: 0 })
        }
        return NextResponse.json({ error: 'Error al registrar el cobro', detail: collErr.message }, { status: 500 })
      }
      await sb
        .from('sale_expected_installments')
        .update({ status: 'collected', flagged_delinquent: false })
        .eq('id', installmentId)

      // Generar comisiones (pendientes) para este cobro — salvo que esté en revisión
      let commissionsGenerated = 0
      if (newCollection && !needsReview) {
        const { data: saleFull } = await sb
          .from('sales')
          .select('id, setter_id, closer_id, affiliate_id, affiliate_commission_percent')
          .eq('tenant_id', t.tenantId)
          .eq('id', inst.sale_id)
          .maybeSingle()
        if (saleFull) {
          commissionsGenerated = await generateCommissionsForCollection(
            sb,
            t.tenantId,
            newCollection as Collection,
            saleFull as Sale
          )
        }
      }
      return NextResponse.json({ ok: true, status: 'collected', commissionsGenerated, needsReview })
    }

    if (action === 'delinquent') {
      await sb
        .from('sale_expected_installments')
        .update({
          flagged_delinquent: true,
          status: 'overdue',
          reminder_count: (inst.reminder_count ?? 0) + 1,
          last_reminder_at: new Date().toISOString(),
        })
        .eq('id', installmentId)
      return NextResponse.json({ ok: true, status: 'overdue' })
    }

    // unflag
    await sb
      .from('sale_expected_installments')
      .update({ flagged_delinquent: false, status: 'pending' })
      .eq('id', installmentId)
    return NextResponse.json({ ok: true, status: 'pending' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
