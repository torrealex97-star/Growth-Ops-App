import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director']

// POST /api/${tenant}/evergreen/sales/delete
// Borra una venta y TODO lo que cuelga de ella (comisiones, devoluciones, cobros) sin tocar la
// agenda que la originó (sales.appointment_id no se propaga: la cita se queda tal cual, solo deja
// de contar como "comprada" porque hasPurchased() se calcula en vivo desde `sales`).
//
// El borrado directo desde el cliente (supabase.from('sales').delete()) fallaba con violación de
// FK en cuanto la venta tenía cualquier fila colgando (cobros, comisiones, contrato, eventos CSM,
// bajas, u otra venta que la referenciara como upsell/reserva de origen) — ninguna de esas FK
// tiene ON DELETE CASCADE salvo sale_expected_installments/document_verifications/
// payment_follow_ups. Por eso hace falta este endpoint server-side:
//   1) Desenlaza (sale_id = NULL) contratos, eventos CSM y bajas — se conservan, solo dejan de
//      apuntar a la venta borrada.
//   2) Desenlaza otras ventas que referencien esta como origin_sale_id/converted_from_reservation_id.
//   3) Borra comisiones → devoluciones → cobros (si se borrara la venta antes, violaría sus FK).
//   4) Borra la venta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { saleId, reason } = await req.json()
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!LEADERSHIP.includes(role)) {
      return NextResponse.json({ error: 'Solo admin/director pueden eliminar ventas' }, { status: 403 })
    }

    const { data: sale } = await sb.from('sales').select('*').eq('id', saleId).eq('tenant_id', t.tenantId).single()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    const [
      { data: collections },
      { data: commissions },
      { data: refunds },
      { data: contracts },
      { data: csmEvents },
      { data: drops },
    ] = await Promise.all([
      sb.from('collections').select('*').eq('sale_id', saleId),
      sb.from('commissions').select('*').eq('sale_id', saleId),
      sb.from('refunds').select('*').eq('sale_id', saleId),
      sb.from('contracts').select('id').eq('sale_id', saleId),
      sb.from('csm_events').select('id').eq('sale_id', saleId),
      sb.from('drops').select('id').eq('sale_id', saleId),
    ])

    // Snapshot ANTES de borrar/desenlazar nada, para poder reconstruir la venta si el borrado fue un error.
    const { error: logErr } = await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'delete',
      old_values: { sale, collections, commissions, refunds, contracts, csmEvents, drops },
      new_values: { reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null },
    })
    if (logErr)
      return NextResponse.json({ error: `No se pudo registrar el borrado: ${logErr.message}` }, { status: 500 })

    // Desenlaza (no borra) filas que solo REFERENCIAN la venta: se conservan sin el vínculo.
    await Promise.all([
      sb.from('contracts').update({ sale_id: null }).eq('sale_id', saleId),
      sb.from('csm_events').update({ sale_id: null }).eq('sale_id', saleId),
      sb.from('drops').update({ sale_id: null }).eq('sale_id', saleId),
      sb.from('sales').update({ origin_sale_id: null }).eq('origin_sale_id', saleId),
      sb.from('sales').update({ converted_from_reservation_id: null }).eq('converted_from_reservation_id', saleId),
    ])

    // Orden que respeta las FK: comisiones → devoluciones → cobros → venta.
    // (sale_expected_installments/document_verifications/payment_follow_ups cascadean solas)
    const { error: commErr } = await sb.from('commissions').delete().eq('sale_id', saleId)
    if (commErr)
      return NextResponse.json({ error: `No se pudieron borrar las comisiones: ${commErr.message}` }, { status: 500 })

    const { error: refErr } = await sb.from('refunds').delete().eq('sale_id', saleId)
    if (refErr)
      return NextResponse.json({ error: `No se pudieron borrar las devoluciones: ${refErr.message}` }, { status: 500 })

    const { error: collErr } = await sb.from('collections').delete().eq('sale_id', saleId)
    if (collErr)
      return NextResponse.json({ error: `No se pudieron borrar los cobros: ${collErr.message}` }, { status: 500 })

    const { error: saleErr } = await sb.from('sales').delete().eq('id', saleId).eq('tenant_id', t.tenantId)
    if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
