import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { calculateNegativeCommissionsForRefund } from '@/lib/commissions/calculator'
import { recomputeRepCommissionTiers } from '@/lib/commissions/generate'
import type { Refund, Commission } from '@/lib/types/database'

export const runtime = 'nodejs'

// Procesa una devolución: valida ventana de 15 días, registra el refund,
// genera comisiones NEGATIVAS (se restan) y marca la venta como devuelta.
// La facturación neta (P&L) ya resta los refunds automáticamente.
export async function POST(req: NextRequest) {
  try {
    const { saleId, grossRefundAmount, reason, override } = await req.json()
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!['admin', 'director'].includes(role || '')) {
      return NextResponse.json({ error: 'Solo admin/director pueden registrar devoluciones' }, { status: 403 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: sale, error: saleErr } = await sb
      .from('sales')
      .select('id, gross_amount, status, refund_deadline_at, setter_id, closer_id, appointment_id')
      .eq('id', saleId)
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
      sale_id: saleId,
      refund_date: today,
      gross_refund_amount: grossRefund,
      commissionable_refund_amount: commRefund,
      reason: reason || null,
      status: 'processed',
      created_by: user.id,
    }).select('*').single()
    if (refErr || !refund) return NextResponse.json({ error: 'Error registrando devolución', detail: refErr?.message }, { status: 500 })

    // 2) Comisiones negativas (se restan de las comisiones del rep)
    const { data: commissions } = await sb.from('commissions').select('*').eq('sale_id', saleId)
    const negatives = calculateNegativeCommissionsForRefund(refund as Refund, (commissions ?? []) as Commission[])
    if (negatives.length) await sb.from('commissions').insert(negatives)

    // 3) Marcar la venta como devuelta / parcial
    await sb.from('sales').update({ status: isFull ? 'refunded' : 'partial_refund', updated_by: user.id }).eq('id', saleId)

    // 4) Recalcular tramos del rep: al bajar el cash collected puede bajar de nivel de comisión
    await recomputeRepCommissionTiers(sb, [
      { repId: (sale as { setter_id?: string | null }).setter_id, role: 'setter' },
      { repId: (sale as { closer_id?: string | null }).closer_id, role: 'closer' },
    ])

    await sb.from('audit_logs').insert({
      actor_user_id: user.id, entity_type: 'sale', entity_id: saleId, action: 'refund',
      new_values: { gross_refund: grossRefund, commissionable_refund: commRefund, negativeCommissions: negatives.length },
    })

    // No hay evento de devolución confirmado en creatuagente (solo venta.registrada); pendiente
    // de confirmar antes de notificar reembolsos.

    return NextResponse.json({ ok: true, grossRefund, commissionableRefund: commRefund, negativeCommissions: negatives.length, saleStatus: isFull ? 'refunded' : 'partial_refund' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
