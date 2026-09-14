import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'
import type { Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// Edita una venta (reps, fecha, importe, estado, notas) y RECONCILIA sus comisiones a partir de los
// cobros reales. Clave: al asignar/cambiar el setter/closer/afiliado de una venta ya creada, se
// generan al instante las comisiones de lo ya cobrado (y se limpian las del rep anterior), de forma
// que la contabilidad queda cuadrada sin fallos. Solo admin/director.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = await req.json()
    const { saleId } = body
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director'].includes(role || '')) {
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

    // Construye el payload solo con los campos enviados (edición parcial)
    const norm = (v: unknown) => (v === 'none' || v === '' || v === undefined ? null : v)
    const payload: Record<string, unknown> = { updated_by: t.userId }
    if ('setter_id' in body) payload.setter_id = norm(body.setter_id)
    if ('closer_id' in body) payload.closer_id = norm(body.closer_id)
    if ('affiliate_id' in body) payload.affiliate_id = norm(body.affiliate_id)
    if ('affiliate_commission_percent' in body) {
      const pct = parseFloat(String(body.affiliate_commission_percent))
      if (payload.affiliate_id && body.affiliate_commission_percent) {
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return NextResponse.json({ error: 'affiliate_commission_percent debe estar entre 0 y 100' }, { status: 400 })
        }
        payload.affiliate_commission_percent = pct
      } else {
        payload.affiliate_commission_percent = null
      }
    }
    if ('sale_date' in body && body.sale_date) payload.sale_date = body.sale_date
    if ('gross_amount' in body && body.gross_amount !== '' && body.gross_amount != null) {
      const gross = parseFloat(String(body.gross_amount))
      if (!Number.isFinite(gross) || gross < 0) {
        return NextResponse.json({ error: 'gross_amount debe ser un número mayor o igual a 0' }, { status: 400 })
      }
      payload.gross_amount = gross
    }
    if ('status' in body && body.status) payload.status = body.status
    if ('notes' in body) payload.notes = body.notes || null
    // Si el admin toca la atribución (setter/closer/afiliado), damos por resuelto el conflicto.
    if ('setter_id' in body || 'closer_id' in body || 'affiliate_id' in body) {
      payload.attribution_conflict = false
    }

    const { error: updErr } = await sb.from('sales').update(payload).eq('id', saleId).eq('tenant_id', t.tenantId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    // Si se cambió el importe de una reserva (plan "reserva": el bruto de la venta ES el depósito
    // cobrado al instante), el cobro registrado en su día se queda con el importe antiguo y "Total
    // cobrado" deja de cuadrar con el precio personalizado. Lo actualizamos junto con la venta.
    if (typeof payload.gross_amount === 'number' && payload.gross_amount !== prev.gross_amount) {
      const { data: plan } = await sb.from('payment_plans').select('method').eq('id', prev.payment_plan_id).single()
      if (plan?.method === 'reserva') {
        const { data: colls } = await sb.from('collections').select('id, gross_amount').eq('sale_id', saleId)
        if (colls && colls.length === 1 && Number(colls[0].gross_amount) === Number(prev.gross_amount)) {
          await sb.from('collections').update({ gross_amount: payload.gross_amount }).eq('id', colls[0].id)
        }
      }
    }

    // Reconciliar comisiones: reps nuevos (ya guardados en la venta) + recalcular tramos de los
    // reps ANTERIORES por si dejaron de estar asignados (bajan de nivel / pierden comisiones).
    const oldReps: { repId: string | null; role: 'setter' | 'closer' }[] = [
      { repId: prev.setter_id, role: 'setter' },
      { repId: prev.closer_id, role: 'closer' },
    ]
    const result = await reconcileSaleCommissions(sb, t.tenantId, saleId, oldReps)

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'update',
      old_values: {
        setter_id: prev.setter_id,
        closer_id: prev.closer_id,
        affiliate_id: prev.affiliate_id,
        gross_amount: prev.gross_amount,
        status: prev.status,
      },
      new_values: { ...payload, reconcile: result },
    })

    // No hay evento de cancelación confirmado en creatuagente (solo venta.registrada); pendiente
    // de confirmar antes de notificar cancelaciones.

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
