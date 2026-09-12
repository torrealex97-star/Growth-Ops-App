import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'

export const runtime = 'nodejs'

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Solo admin/director pueden editar/eliminar cobros (afecta a la contabilidad y a las comisiones).
async function requireAdmin(sb: ReturnType<typeof serviceClient>) {
  const authed = await createServerClient()
  const {
    data: { user },
  } = await authed.auth.getUser()
  if (!user) return { error: 'No autenticado', status: 401 as const }
  const { data } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
  const role = (data?.roles as { key?: string } | null)?.key
  if (role !== 'admin' && role !== 'director') return { error: 'Sin permisos', status: 403 as const }
  return { ok: true as const, userId: user.id }
}

// Si tras borrar/editar la cuota asociada se queda sin ningún cobro (no revertido), la devolvemos a
// 'pending' para que pueda re-cobrarse limpiamente; si sigue teniendo un cobro, la dejamos 'collected'.
async function syncInstallmentStatus(sb: ReturnType<typeof serviceClient>, installmentId: string | null) {
  if (!installmentId) return
  const { data: remaining } = await sb
    .from('collections')
    .select('id')
    .eq('expected_installment_id', installmentId)
    .neq('status', 'reversed')
    .limit(1)
  const hasCollection = !!(remaining && remaining.length > 0)
  await sb
    .from('sale_expected_installments')
    .update({ status: hasCollection ? 'collected' : 'pending' })
    .eq('id', installmentId)
}

// PATCH — edita un cobro (importe, comisionable, fecha, método, elegibilidad) y RECONCILIA las
// comisiones de la venta con los cobros resultantes.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const sb = serviceClient()
    const guard = await requireAdmin(sb)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json()

    const { data: coll } = await sb
      .from('collections')
      .select(
        'id, sale_id, gross_amount, commissionable_amount, sales!inner(payment_plans(cash_collection_ratio, fee_percent))'
      )
      .eq('id', id)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!coll) return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 })

    const plan = (
      coll.sales as unknown as { payment_plans?: { cash_collection_ratio?: number; fee_percent?: number } } | null
    )?.payment_plans
    const ratio = Number(plan?.cash_collection_ratio ?? 1)
    const feePercent = Number(plan?.fee_percent ?? 0)
    const round2 = (n: number) => Math.round(n * 100) / 100

    const update: Record<string, unknown> = {}
    if (body.gross_amount != null && body.gross_amount !== '') {
      const gross = Number(body.gross_amount)
      if (isNaN(gross) || gross < 0) return NextResponse.json({ error: 'Importe inválido' }, { status: 400 })
      update.gross_amount = round2(gross)
      // Recalcula comisionable y fee según el plan, salvo que se pase un comisionable explícito.
      if (body.commissionable_amount != null && body.commissionable_amount !== '') {
        const comm = Number(body.commissionable_amount)
        if (!Number.isFinite(comm) || comm < 0 || comm > gross + 0.01) {
          return NextResponse.json({ error: 'commissionable_amount inválido' }, { status: 400 })
        }
        update.commissionable_amount = round2(comm)
      } else {
        update.commissionable_amount = round2(gross * ratio)
      }
      update.processing_fee = round2(gross * (feePercent / 100))
    } else if (body.commissionable_amount != null && body.commissionable_amount !== '') {
      const comm = Number(body.commissionable_amount)
      const currentGross = Number(coll.gross_amount)
      if (!Number.isFinite(comm) || comm < 0 || comm > currentGross + 0.01) {
        return NextResponse.json({ error: 'commissionable_amount inválido' }, { status: 400 })
      }
      update.commissionable_amount = round2(comm)
    }
    if (body.collected_at) update.collected_at = new Date(body.collected_at).toISOString()
    if (typeof body.payment_method === 'string') update.payment_method = body.payment_method || null
    if (typeof body.is_eligible_for_commission === 'boolean') {
      update.is_eligible_for_commission = body.is_eligible_for_commission
      // Si un admin fuerza la elegibilidad a mano, saca el cobro de revisión (si no,
      // reconcileSaleCommissions lo seguiría excluyendo y la comisión nunca se generaría).
      if (body.is_eligible_for_commission) update.needs_commission_review = false
    }
    if (typeof body.needs_commission_review === 'boolean') update.needs_commission_review = body.needs_commission_review
    if (typeof body.status === 'string' && ['collected', 'reversed', 'disputed'].includes(body.status))
      update.status = body.status

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const { error: upErr } = await sb.from('collections').update(update).eq('id', id).eq('tenant_id', t.tenantId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // Reconcilia comisiones (positivas no liquidadas) de la venta con los cobros actuales.
    const recon = await reconcileSaleCommissions(sb, coll.sale_id)

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: guard.userId,
      entity_type: 'collection',
      entity_id: id,
      action: 'update',
      old_values: { gross_amount: coll.gross_amount, commissionable_amount: coll.commissionable_amount },
      new_values: update,
    })

    return NextResponse.json({ ok: true, reconciled: recon })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// DELETE — elimina un cobro (p.ej. un duplicado), borra sus comisiones y RECONCILIA la venta para
// que el cash collected y las comisiones cuadren con los cobros reales.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const sb = serviceClient()
    const guard = await requireAdmin(sb)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const { data: coll } = await sb
      .from('collections')
      .select('id, sale_id, expected_installment_id, gross_amount')
      .eq('id', id)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!coll) return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 })

    // No permitir borrar un cobro con comisiones ya LIQUIDADAS (ya pagadas al comercial).
    const { data: liq } = await sb
      .from('commissions')
      .select('id')
      .eq('collection_id', id)
      .eq('status', 'liquidated')
      .limit(1)
    if (liq && liq.length > 0) {
      return NextResponse.json(
        { error: 'Este cobro tiene comisiones ya liquidadas; no se puede eliminar.' },
        { status: 409 }
      )
    }

    // Borra primero las comisiones del cobro (evita conflictos de FK), luego el cobro.
    await sb.from('commissions').delete().eq('collection_id', id)
    const { error: delErr } = await sb.from('collections').delete().eq('id', id).eq('tenant_id', t.tenantId)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    // La cuota asociada vuelve a 'pending' si se queda sin cobros; si tenía otro (duplicado), 'collected'.
    await syncInstallmentStatus(sb, coll.expected_installment_id)

    // Reconcilia comisiones de la venta con los cobros restantes (recalcula tramos de los reps).
    const recon = await reconcileSaleCommissions(sb, coll.sale_id)

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: guard.userId,
      entity_type: 'collection',
      entity_id: id,
      action: 'delete',
      old_values: { sale_id: coll.sale_id, gross_amount: coll.gross_amount },
    })

    return NextResponse.json({ ok: true, reconciled: recon })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
