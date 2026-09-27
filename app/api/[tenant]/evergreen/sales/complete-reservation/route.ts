import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'
import type { Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// ALLOWLIST de columnas que "completar reserva" puede tocar — EXACTAMENTE las que envía
// app/[tenant]/ventas/registro/nueva/page.tsx (updatePayload + teamFields + buyerFields).
// Sin esto, `{ ...patch, updated_by }` deja que cualquier rol permitido (manager/closer/
// setter/cobros, no solo admin/director) escriba CUALQUIER columna de `sales` vía
// service-role — que salta la RLS a propósito para este flujo. Un patch con `gross_amount`,
// `status` o `tenant_id` fuera de estos campos pasaría sin que la base lo impida.
const ALLOWED_PATCH_FIELDS = new Set([
  'appointment_id',
  'product_id',
  'payment_plan_id',
  'sale_date',
  'refund_deadline_at',
  'gross_amount',
  'expected_commissionable_amount',
  'reservation_amount',
  'down_payment_amount',
  'installments_count',
  'installments_start_date',
  'reservation_completed_at',
  'payment_method',
  'custom_plan',
  'payment_proof_path',
  'setter_id',
  'closer_id',
  'affiliate_id',
  'affiliate_commission_percent',
  'buyer_is_scheduler',
  'payer_data',
  'access_email',
  'status',
  'notes',
])

// Allowlist de columnas por fila del calendario de cuotas (buildInstallmentRows /
// buildRestInstallments de la UI): sale_id/tenant_id van sellados por el servidor al construir la
// fila. Sin esto, el spread del cliente permitía columnas o estados no previstos — p. ej.
// is_monitoring=true esconde la cuota del motor de morosidad (flagged_delinquent sale de ahí).
const ALLOWED_INSTALLMENT_FIELDS = new Set([
  'sale_id',
  'installment_number',
  'due_date',
  'expected_gross_amount',
  'expected_commissionable_amount',
  'status',
  'is_monitoring',
])

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

    const camposNoPermitidos = Object.keys(patch).filter((k) => !ALLOWED_PATCH_FIELDS.has(k))
    if (camposNoPermitidos.length > 0) {
      return NextResponse.json(
        { error: `Campos no permitidos en completar reserva: ${camposNoPermitidos.join(', ')}` },
        { status: 400 }
      )
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

    // Regenera el calendario de cuotas (por si se recompleta): borra las previas e inserta las
    // nuevas. Si el borrado falla y el insert sigue adelante, el calendario queda DUPLICADO
    // (viejas cuotas + nuevas) — se comprueba antes de insertar, igual que el resto de escrituras
    // de dinero de esta ruta.
    const { error: delInstErr } = await sb.from('sale_expected_installments').delete().eq('sale_id', saleId)
    if (delInstErr)
      return NextResponse.json(
        { error: `No se pudo limpiar el calendario de cuotas anterior: ${delInstErr.message}` },
        { status: 500 }
      )
    if (Array.isArray(installments) && installments.length > 0) {
      // Mismo criterio que el patch: el cliente construye filas con campos fijos; cualquier campo
      // fuera de la allowlist se rechaza antes de tocar la base. sale_id/tenant_id se sellan aquí
      // (nunca salen del cuerpo).
      const filasNoPermitidas = [
        ...new Set(
          (installments as Record<string, unknown>[]).flatMap((r) =>
            Object.keys(r).filter((k) => !ALLOWED_INSTALLMENT_FIELDS.has(k))
          )
        ),
      ]
      if (filasNoPermitidas.length > 0) {
        return NextResponse.json(
          { error: `Campos no permitidos en las cuotas: ${filasNoPermitidas.join(', ')}` },
          { status: 400 }
        )
      }
      const rows = (installments as Record<string, unknown>[]).map((r) => ({
        sale_id: saleId,
        tenant_id: t.tenantId,
        installment_number: r.installment_number,
        due_date: r.due_date,
        expected_gross_amount: r.expected_gross_amount,
        expected_commissionable_amount: r.expected_commissionable_amount,
        status: r.status,
        is_monitoring: r.is_monitoring,
      }))
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
