import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { calculateNegativeCommissionsForRefund } from '@/lib/commissions/calculator'
import { recomputeRepCommissionTiers } from '@/lib/commissions/generate'
import type { Refund, Commission } from '@/lib/types/database'

export const runtime = 'nodejs'

// Procesa una devolución: valida ventana de 15 días, registra el refund,
// genera comisiones NEGATIVAS (se restan) y marca la venta como devuelta.
// La facturación neta (P&L) ya resta los refunds automáticamente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { saleId, grossRefundAmount, reason, override } = await req.json()
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!['admin', 'director'].includes(role || '')) {
      return NextResponse.json({ error: 'Solo admin/director pueden registrar devoluciones' }, { status: 403 })
    }

    const { data: sale, error: saleErr } = await sb
      .from('sales')
      .select('id, gross_amount, status, refund_deadline_at, setter_id, closer_id, appointment_id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (saleErr || !sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    // Ventana de devolución: 15 días desde la compra (refund_deadline_at)
    const today = new Date().toISOString().slice(0, 10)
    const withinWindow = sale.refund_deadline_at ? today <= sale.refund_deadline_at : false
    if (!withinWindow && !override) {
      return NextResponse.json({
        error: `Fuera del plazo de devolución (venció el ${sale.refund_deadline_at}). No procede devolución.`,
        outOfWindow: true,
      }, { status: 422 })
    }

    // Importes: por defecto se devuelve lo COBRADO (cash collected)
    const { data: collections } = await sb
      .from('collections')
      .select('gross_amount, commissionable_amount, status')
      .eq('sale_id', saleId)
      .eq('status', 'collected')
    const totalGross = (collections ?? []).reduce((s, c) => s + Number(c.gross_amount || 0), 0)
    const totalComm = (collections ?? []).reduce((s, c) => s + Number(c.commissionable_amount || 0), 0)

    const grossRefund = grossRefundAmount != null ? Number(grossRefundAmount) : totalGross
    // Comisionable proporcional al importe devuelto
    const commRefund = totalGross > 0 ? (grossRefund / totalGross) * totalComm : grossRefund
    const isFull = grossRefund >= totalGross - 0.01

    // 1) Registrar la devolución
    const { data: refund, error: refErr } = await sb.from('refunds').insert({
      tenant_id: t.tenantId,
      sale_id: saleId,
      refund_date: today,
      gross_refund_amount: grossRefund,
      commissionable_refund_amount: commRefund,
      reason: reason || null,
      status: 'processed',
      created_by: t.userId,
    }).select('*').single()
    if (refErr || !refund) return NextResponse.json({ error: 'Error registrando devolución', detail: refErr?.message }, { status: 500 })

    // 2) Comisiones negativas (se restan de las comisiones del rep)
    const { data: commissions } = await sb.from('commissions').select('*').eq('sale_id', saleId)
    const negatives = calculateNegativeCommissionsForRefund(refund as Refund, (commissions ?? []) as Commission[])
      .map((n) => ({ ...n, tenant_id: t.tenantId }))
    if (negatives.length) await sb.from('commissions').insert(negatives)

    // 3) Marcar la venta como devuelta / parcial
    await sb.from('sales').update({ status: isFull ? 'refunded' : 'partial_refund', updated_by: t.userId }).eq('id', saleId)

    // 4) Recalcular tramos del rep: al bajar el cash collected puede bajar de nivel de comisión
    await recomputeRepCommissionTiers(sb, [
      { repId: (sale as { setter_id?: string | null }).setter_id, role: 'setter' },
      { repId: (sale as { closer_id?: string | null }).closer_id, role: 'closer' },
    ])

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId, entity_type: 'sale', entity_id: saleId, action: 'refund',
      new_values: { gross_refund: grossRefund, commissionable_refund: commRefund, negativeCommissions: negatives.length },
    })

    // No hay evento de devolución confirmado en creatuagente (solo venta.registrada); pendiente
    // de confirmar antes de notificar reembolsos.

    return NextResponse.json({ ok: true, grossRefund, commissionableRefund: commRefund, negativeCommissions: negatives.length, saleStatus: isFull ? 'refunded' : 'partial_refund' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
