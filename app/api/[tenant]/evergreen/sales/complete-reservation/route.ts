import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'
import type { Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// Completa una RESERVA: promueve la venta (misma fila) al plan final y marca reservation_completed_at.
// Va por SERVICE ROLE porque `sales`/`sale_expected_installments` solo permiten UPDATE/INSERT a
// admin/director vía RLS. Un closer/setter que completaba el pago desde el cliente hacía un UPDATE
// que la RLS filtraba en silencio (0 filas, sin error): el cobro (server-side) sí quedaba, pero la
// venta seguía como reserva de 300 € (facturación mal, pipeline sin mover). Aquí se hace server-side.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { saleId, patch, installments } = await req.json()
    if (!saleId || !patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: prevData, error: prevErr } = await sb
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (prevErr || !prevData) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })
    const prev = prevData as Sale

    const payload = { ...patch, updated_by: t.userId }
    const { error: updErr } = await sb.from('sales').update(payload).eq('id', saleId).eq('tenant_id', t.tenantId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    // Regenera el calendario de cuotas (por si se recompleta): borra las previas e inserta las nuevas.
    await sb.from('sale_expected_installments').delete().eq('sale_id', saleId)
    if (Array.isArray(installments) && installments.length > 0) {
      const rows = installments.map((r: Record<string, unknown>) => ({ ...r, sale_id: saleId, tenant_id: t.tenantId }))
      const { error: instErr } = await sb.from('sale_expected_installments').insert(rows)
      if (instErr) return NextResponse.json({ error: instErr.message }, { status: 500 })
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'update',
      old_values: {
        gross_amount: prev.gross_amount,
        payment_plan_id: prev.payment_plan_id,
        payment_method: prev.payment_method,
        reservation_completed_at: prev.reservation_completed_at,
      },
      new_values: { ...payload, _accion: 'completar_reserva' },
    })

    // La reserva ya es cliente: el cobro de la reserva (que se dejó sin comisionar a propósito,
    // ver saleNeedsCommissionReview) ahora sí debe comisionar. Se reabre y se reconcilia junto con
    // cualquier otro cobro elegible de esta venta, sin tocar nada ya liquidado.
    const { error: reopenErr } = await sb
      .from('collections')
      .update({
        needs_commission_review: false,
        is_eligible_for_commission: true,
        eligible_at: new Date().toISOString(),
      })
      .eq('tenant_id', t.tenantId)
      .eq('sale_id', saleId)
      .eq('needs_commission_review', true)
    if (reopenErr) {
      return NextResponse.json(
        { error: `Reserva completada, pero no se pudo reabrir su cobro para comisionar: ${reopenErr.message}` },
        { status: 500 }
      )
    }
    await reconcileSaleCommissions(sb, t.tenantId, saleId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
