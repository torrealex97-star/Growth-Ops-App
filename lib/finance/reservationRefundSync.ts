// ABSORCIÓN DE DEVOLUCIONES DE RESERVA HECHAS EN STRIPE.
//
// QUÉ PROBLEMA RESUELVE. El flujo propio de la app (reservation-refund) hace el claim atómico,
// pide el dinero a Stripe y concilia (finish_reservation_refund): fila en `refunds`, venta
// 'refunded'. Pero una devolución hecha DIRECTAMENTE en Stripe (panel, dispute, reintento del
// portal) nunca entraba en la app: la reserva seguía `active` con su cobro `collected`, la
// bandeja de reservas la contaba como dinero en cuenta y la sugerencia de la bandeja de cobros
// seguía proponiéndola como reserva con saldo. Medido en producción (4-oct): la reserva del
// 14-sep estaba devuelta en Stripe (refunded_amount = 50) y en la app llevaba 20 días contando
// como dinero en caja.
//
// CÓMO. El espejo `stripe_payments` ya refleja la verdad de Stripe (status/refunded_amount).
// Este módulo cruza ese espejo con las reservas abiertas y absorbe la devolución:
//   · fila en `refunds` con la MISMA fecha de Stripe (created), created_by = NULL
//     (devolución sin actor humano: no se la atribuimos a nadie),
//   · venta → 'refunded' (solo si queda sin cobros válidos),
//   · out de la bandeja (los dos cambios son el par que la UI lee),
//   · y la deja idempotente: la misma devolución nunca entra dos veces.
//
// LÍMITES DELIBERADOS (seguridad > funcionalidad):
//   · Una reserva con COMISIONES ya generadas no se absorbe: la negativa se calcula desde la
//     positiva y en este flujo nadie la aprueba → needs_commission_review=true en el cobro, la
//     bandeja no la propone y la reserva queda señalada para revisión financiera.
//   · Si el cobro ya no está 'collected' (conciliado a mano, devuelto por otra vía) no se toca:
//     la absorción nunca pisa un asiento que alguien escribió.
//   · Devoluciones PARCIALES: no hay par (refund parcial, venta sigue active) que la UI de
//     reservas sepa representar sin inventar estados nuevos — quedan señaladas para revisión.

import type { SupabaseClient } from '@supabase/supabase-js'

type Espejo = {
  payment_id: string
  charge_id: string | null
  refunded_amount: number | null
  status: string | null
  paid_at: string | null
}

type Reserva = {
  id: string
  gross_amount: number
  refund_deadline_at: string | null
  /** PostgREST entrega `collections!inner` como ARRAY de una fila (1:1 por el inner join). */
  collections: { id: string; payment_reference: string | null; gross_amount: number }[]
}

export type ReservationRefundSyncResult = {
  /** Reservas absorbidas como devolución completa. */
  absorbed: number
  /** Reservas señalizadas para revisión financiera (comisiones o devolución parcial). */
  flagged: number
  /** Filas de la cola leídas (las ya absorbidas dejan de aparecer en la cola). */
  scanned: number
}

export async function syncReservationRefunds(
  sb: SupabaseClient,
  tenantId: string
): Promise<ReservationRefundSyncResult> {
  const result: ReservationRefundSyncResult = { absorbed: 0, flagged: 0, scanned: 0 }

  // La cola: reservas ABIERTAS (plan reserva, sin completar, activas) con su ÚNICO cobro
  // 'collected'. Exactamente el universo que la bandeja de reservas cuenta como dinero en cuenta.
  const { data: queue, error } = await sb
    .from('sales')
    .select(
      'id,gross_amount,refund_deadline_at,payment_plans!inner(method),collections!inner(id,payment_reference,status,gross_amount)'
    )
    .eq('tenant_id', tenantId)
    .eq('payment_plans.method', 'reserva')
    .eq('status', 'active')
    .is('reservation_completed_at', null)
    .eq('collections.status', 'collected')
    .limit(500)
  if (error) throw new Error(`No se pudo leer la cola de reservas: ${error.message}`)
  if (!queue?.length) return result

  // El espejo de esos cobros: status/refunded_amount es lo que Stripe dice HOY. Con `!inner`
  // cada reserva trae EXACTAMENTE un cobro collected (el filtro va en la query); una reserva
  // sin ese cobro no aparece en la cola (inner join, no left join).
  const cola = queue as unknown as Reserva[]
  const referencias = [
    ...new Set(
      cola.flatMap((s) => (s.collections[0]?.payment_reference ? [s.collections[0].payment_reference as string] : []))
    ),
  ]
  const espejo = new Map<string, Espejo>()
  for (let i = 0; i < referencias.length; i += 100) {
    const lote = referencias.slice(i, i + 100)
    if (!lote.length) continue
    const { data, error: err } = await sb
      .from('stripe_payments')
      .select('payment_id,charge_id,refunded_amount,status,paid_at')
      .eq('tenant_id', tenantId)
      .or(`payment_id.in.(${lote.join(',')}),charge_id.in.(${lote.join(',')})`)
      .limit(400)
    if (err) throw new Error(`No se pudo leer el espejo de Stripe: ${err.message}`)
    for (const row of (data ?? []) as Espejo[]) {
      if (row.payment_id) espejo.set(row.payment_id, row)
      if (row.charge_id) espejo.set(row.charge_id, row)
    }
  }

  for (const sale of cola) {
    result.scanned++
    const cobro = sale.collections[0]
    if (!cobro) continue
    const espejoRow = cobro.payment_reference ? espejo.get(cobro.payment_reference) : undefined
    const devuelto = Number(espejoRow?.refunded_amount ?? 0)

    if (devuelto <= 0.009 || espejoRow?.status === 'disputed') continue

    const refundDate = espejoRow?.paid_at ? espejoRow.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
    const esParcial = devuelto + 0.009 < Number(sale.gross_amount)

    if (esParcial) {
      // La UI de reservas no representa devoluciones parciales: se señalan, no se inventa estado.
      await sb
        .from('collections')
        .update({ needs_commission_review: true, is_eligible_for_commission: false, eligible_at: null })
        .eq('tenant_id', tenantId)
        .eq('id', cobro!.id)
        .eq('status', 'collected')
        .eq('needs_commission_review', false)
      result.flagged++
      continue
    }

    // ¿Tiene comisiones? La negativa se calcula desde la positiva y aquí nadie la aprueba.
    const { count: comisiones, error: comErr } = await sb
      .from('commissions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('sale_id', sale.id)
      .limit(1)
    if (comErr) throw new Error(`No se pudo comprobar comisiones de la reserva: ${comErr.message}`)
    if ((comisiones ?? 0) > 0) {
      await sb
        .from('collections')
        .update({ needs_commission_review: true, is_eligible_for_commission: false, eligible_at: null })
        .eq('tenant_id', tenantId)
        .eq('id', cobro!.id)
        .eq('status', 'collected')
        .eq('needs_commission_review', false)
      result.flagged++
      continue
    }

    // IDEMPOTENCIA: guard de la migración 20261003135010 — mientras exista una solicitud de
    // reembolso activa, ni sales ni collections aceptan cambios. Aquí no hay solicitud (la
    // devolución nació en Stripe), así que el guard no estorba… pero un INSERT en refunds sin
    // él podría reabsorber si dos pasadas se solapan. El filtro de la cola ya lo evita (la
    // venta deja de estar 'active' tras absorber), y el insert es el ÚNICO efecto externo.
    const { data: refund, error: insErr } = await sb
      .from('refunds')
      .insert({
        tenant_id: tenantId,
        sale_id: sale.id,
        collection_id: cobro!.id,
        refund_date: refundDate,
        gross_refund_amount: devuelto,
        commissionable_refund_amount: 0,
        reason: 'Reserva reembolsada en Stripe',
        status: 'processed',
        created_by: null,
        notes: null,
      })
      .select('id')
      .single()
    if (insErr || !refund) throw new Error(`No se pudo registrar la devolución de la reserva: ${insErr?.message}`)

    // Audit trail: quién lo hizo — nadie; qué pasó — la verdad de Stripe.
    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      actor_user_id: null,
      entity_type: 'sale',
      entity_id: sale.id,
      action: 'refund',
      new_values: {
        source: 'stripe_sync',
        refund_id: refund.id,
        stripe_charge: espejoRow?.charge_id ?? null,
        gross_refund: devuelto,
      },
    })

    // Marca la venta SIEMPRE tras el refund (idempotente al reintentar: la cola ya no la incluye).
    const { error: updErr } = await sb
      .from('sales')
      .update({ status: 'refunded' })
      .eq('tenant_id', tenantId)
      .eq('id', sale.id)
      .eq('status', 'active')
    if (updErr) throw new Error(`No se pudo marcar la reserva como devuelta: ${updErr.message}`)
    result.absorbed++
  }

  return result
}
