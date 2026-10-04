import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'

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

    const { saleId, patch, installments, firstPayment } = await req.json()
    if (!saleId || !patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!t.isSuperAdmin && !['admin', 'director', 'manager', 'closer', 'setter', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const camposNoPermitidos = Object.keys(patch).filter((k) => !ALLOWED_PATCH_FIELDS.has(k))
    if (camposNoPermitidos.length > 0) {
      return NextResponse.json(
        { error: `Campos no permitidos en completar reserva: ${camposNoPermitidos.join(', ')}` },
        { status: 400 }
      )
    }

    if (!Number.isFinite(firstPayment) || firstPayment <= 0 || !Array.isArray(installments)) {
      return NextResponse.json(
        { error: 'Registra el primer pago del plan para completar la reserva.' },
        { status: 400 }
      )
    }
    if (installments.some((r: unknown) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return NextResponse.json({ error: 'Cuotas inválidas' }, { status: 400 })
    }
    const filasNoPermitidas = installments.flatMap((r: Record<string, unknown>) =>
      Object.keys(r).filter((k) => !ALLOWED_INSTALLMENT_FIELDS.has(k))
    )
    if (filasNoPermitidas.length)
      return NextResponse.json({ error: 'Campos no permitidos en las cuotas' }, { status: 400 })
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
    const { error: completionError } = await sb.rpc('complete_reservation_with_payment', {
      p_tenant: t.tenantId,
      p_sale: saleId,
      p_actor: t.userId,
      p_patch: patch,
      p_installments: rows,
      p_first_payment: firstPayment,
    })
    if (completionError) {
      // El RPC valida con mensajes propios y cortos: se traducen a una acción concreta en vez del
      // error genérico, que ocultaba CUÁL invariante falló (p.ej. elegir el plan de reserva como
      // plan final, o la entrada vacía con un plan a plazos).
      const causa = (completionError.message ?? '').trim()
      const accion: Record<string, string> = {
        'Reservation not found': 'La reserva ya no existe (¿se eliminó?). Actualiza la página.',
        'Reservation already converted': 'Esta reserva ya está completada. Actualiza la página.',
        'Not an open reservation': 'Esta venta ya no es una reserva abierta. Actualiza la página.',
        'Invalid final payment plan':
          'El plan final no corresponde al producto de la reserva (ni puede ser el plan de reserva). Revisa producto y plan en el paso 2.',
        'Invalid appointment': 'La cita vinculada ya no existe. Revisa el paso de la cita.',
        'Invalid team member': 'El setter, closer o colaborador elegido no pertenece a esta subcuenta.',
        'A first payment is required':
          'El primer pago no encaja: revisa el importe total del plan, la reserva ya pagada y la entrada (no puede ser 0 en un plan a plazos).',
        'Reconcile the original deposit before conversion':
          'El anticipo de la reserva no está cuadrado en la app (falta, sobra o está reembolsado). Revísalo en la venta antes de completar.',
        'Invalid installment': 'Hay cuotas inválidas en el calendario del plan. Revisa entrada y número de cuotas.',
        'Installment calendar does not match the outstanding amount':
          'El calendario de cuotas no suma el importe pendiente. Revisa la entrada y el número de cuotas.',
        'Invalid financing payout': 'El desembolso de la financiación no coincide con el plan (Sequra).',
      }
      return NextResponse.json(
        {
          error:
            accion[causa] ??
            'No se completó la reserva. Comprueba el cobro original, el primer pago y el plan; no se ha guardado una conversión parcial.',
        },
        { status: 409 }
      )
    }
    try {
      await reconcileSaleCommissions(sb, t.tenantId, saleId)
    } catch {
      return NextResponse.json({
        ok: true,
        warning: 'Reserva completada y cobro registrado. Las comisiones requieren revisión; no repitas el pago.',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
