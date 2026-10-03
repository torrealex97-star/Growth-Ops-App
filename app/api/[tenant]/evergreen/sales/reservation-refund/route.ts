import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { stripeGet } from '@/lib/stripe/client'
import { executeReservationRefund, type ReservationRefundRequest } from '@/lib/stripe/reservation-refund'
import { businessToday } from '@/lib/dates/business'

export const runtime = 'nodejs'
export const maxDuration = 60
const input = z.object({
  saleId: z.string().uuid(),
  amountCents: z.number().int().positive().optional(),
  confirm: z.boolean().optional(),
  allowOutsideWindow: z.boolean().optional(),
})

// Preview and execution share the same authorized source. Only an explicit confirmation moves money.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && !['admin', 'director'].includes(session.role ?? ''))
    return NextResponse.json({ error: 'Solo administración puede reembolsar reservas.' }, { status: 403 })
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 })
  const body = parsed.data
  const fail = (error: string, status = 409) => NextResponse.json({ error }, { status })
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: previous, error: previousError } = await sb
      .from('reservation_refund_requests')
      .select('id,tenant_id,sale_id,charge_id,stripe_account_id,amount_cents,status,stripe_refund_id,created_at')
      .eq('tenant_id', session.tenantId)
      .eq('sale_id', body.saleId)
      .maybeSingle()
    if (previousError)
      return fail('No se puede leer el registro de reembolsos. No se ha solicitado dinero a Stripe.', 503)
    const cfg = await getTenantConfigWithFallback(session.tenantId, true)
    if (!cfg.STRIPE_SECRET_KEY) return fail('Stripe no está configurado.', 503)
    const auth = { secretKey: cfg.STRIPE_SECRET_KEY, accountId: cfg.STRIPE_ACCOUNT_ID }
    const account = await stripeGet<{ id: string }>('account', new URLSearchParams(), auth, 8_000)
    let request = previous as ReservationRefundRequest | null
    if (request && request.stripe_account_id !== account.id)
      return fail('La cuenta Stripe ha cambiado. Revisa la solicitud original.')
    if (request?.status === 'succeeded')
      return NextResponse.json({ status: 'succeeded', amountCents: request.amount_cents })
    if (request?.status === 'failed')
      return fail('Stripe rechazó esta devolución. Revisa su estado antes de crear otra solicitud.')
    let amountCents = Number(request?.amount_cents ?? 0)
    let chargeId = request?.charge_id ?? ''
    if (!request) {
      const { data: sale, error } = await sb
        .from('sales')
        .select('id,gross_amount,status,reservation_completed_at,refund_deadline_at,payment_plans!inner(method)')
        .eq('tenant_id', session.tenantId)
        .eq('id', body.saleId)
        .eq('payment_plans.method', 'reserva')
        .maybeSingle()
      if (error) return fail('No se pudo leer la reserva.', 503)
      if (!sale || sale.status !== 'active' || sale.reservation_completed_at)
        return fail('La reserva ya no está abierta.')
      const { data: collections, error: collectionError } = await sb
        .from('collections')
        .select('id,gross_amount,payment_reference')
        .eq('tenant_id', session.tenantId)
        .eq('sale_id', body.saleId)
        .eq('status', 'collected')
      if (collectionError) return fail('No se pudieron comprobar los cobros.', 503)
      if (collections?.length !== 1 || !/^(pi|ch)_[A-Za-z0-9]+$/.test(collections[0].payment_reference ?? ''))
        return fail(
          'La reserva necesita un único cobro Stripe identificado. Vincula el cobro original antes de reembolsar.'
        )
      const collection = collections[0]
      const { data: mirror, error: mirrorError } = await sb
        .from('stripe_payments')
        .select('charge_id,amount,currency')
        .eq('tenant_id', session.tenantId)
        .eq(collection.payment_reference.startsWith('pi_') ? 'payment_id' : 'charge_id', collection.payment_reference)
        .maybeSingle()
      if (mirrorError) return fail('No se pudo verificar la fuente Stripe.', 503)
      amountCents = Math.round(Number(collection.gross_amount) * 100)
      if (
        !mirror?.charge_id ||
        mirror.currency.toLowerCase() !== 'eur' ||
        Math.round(Number(mirror.amount) * 100) !== amountCents ||
        Math.round(Number(sale.gross_amount) * 100) !== amountCents
      )
        return fail('Los importes o la fuente de la reserva necesitan conciliación antes del reembolso.')
      chargeId = mirror.charge_id
      if (!/^ch_[A-Za-z0-9]+$/.test(chargeId) || amountCents <= 0) return fail('Referencia o importe no válido.')
      const charge = await stripeGet<{
        id: string
        amount: number
        amount_refunded: number
        currency: string
        paid: boolean
        disputed: boolean
      }>(`charges/${chargeId}`, new URLSearchParams(), auth, 8_000)
      if (
        charge.id !== chargeId ||
        charge.amount !== amountCents ||
        charge.amount_refunded !== 0 ||
        charge.currency !== 'eur' ||
        !charge.paid ||
        charge.disputed
      )
        return fail('Stripe indica que este cobro no admite la devolución completa de la reserva.')
      const [refunds, commissions, conversions] = await Promise.all([
        sb.from('refunds').select('id').eq('tenant_id', session.tenantId).eq('sale_id', body.saleId).limit(1),
        sb.from('commissions').select('id').eq('tenant_id', session.tenantId).eq('sale_id', body.saleId).limit(1),
        sb
          .from('sales')
          .select('id')
          .eq('tenant_id', session.tenantId)
          .eq('converted_from_reservation_id', body.saleId)
          .limit(1),
      ])
      if (refunds.error || commissions.error || conversions.error)
        return fail('No se pudo comprobar la contabilidad.', 503)
      if (conversions.data.length)
        return fail('Esta reserva ya está vinculada a otra venta. Revisa el plan definitivo antes de reembolsar.')
      if (refunds.data.length || commissions.data.length)
        return fail(
          'Esta reserva tiene devoluciones o comisiones. Requiere conciliación financiera antes de reembolsar.'
        )
      const outsideWindow = !sale.refund_deadline_at || businessToday() > sale.refund_deadline_at
      if (!body.confirm)
        return NextResponse.json({
          status: 'ready',
          amountCents,
          paymentReference: collection.payment_reference,
          outsideWindow,
        })
      if (outsideWindow && !body.allowOutsideWindow)
        return fail('Confirma expresamente la devolución fuera del plazo habitual.')
      if (body.amountCents !== amountCents) return fail('El importe ha cambiado. Abre de nuevo la confirmación.')
      const { data: claimed, error: claimError } = await sb.rpc('claim_reservation_refund', {
        p_tenant: session.tenantId,
        p_sale: body.saleId,
        p_actor: session.userId,
        p_charge: chargeId,
        p_account: account.id,
        p_amount: amountCents,
      })
      if (claimError || !claimed)
        return fail('No se pudo reservar la operación. Actualiza la reserva antes de reintentar.')
      request = claimed as ReservationRefundRequest
    }
    if (!body.confirm) return NextResponse.json({ status: request.status, amountCents, paymentReference: chargeId })
    if (body.amountCents !== amountCents) return fail('El importe confirmado no coincide con la solicitud.')
    const refund = await executeReservationRefund(request, auth)
    if (refund.status === 'succeeded') {
      const { error } = await sb.rpc('finish_reservation_refund', {
        p_tenant: session.tenantId,
        p_request: request.id,
        p_stripe_refund: refund.id,
        p_date: businessToday(new Date(refund.created * 1000)),
      })
      if (error)
        return fail(
          'Stripe ha devuelto el dinero; falta conciliar la app. Pulsa comprobar estado: no creará otro reembolso.',
          503
        )
      return NextResponse.json({ status: 'succeeded', amountCents })
    }
    const status = ['failed', 'canceled'].includes(refund.status) ? 'failed' : 'pending'
    const { error } = await sb
      .from('reservation_refund_requests')
      .update({ status, stripe_refund_id: refund.id, updated_at: new Date().toISOString() })
      .eq('tenant_id', session.tenantId)
      .eq('id', request.id)
      .neq('status', 'succeeded')
    if (error) return fail('Solicitud enviada a Stripe; no se pudo guardar el estado. Comprueba de nuevo.', 503)
    return NextResponse.json({ status, amountCents })
  } catch {
    return fail('No se pudo confirmar el resultado. Comprueba el estado antes de realizar otra operación.', 503)
  }
}
