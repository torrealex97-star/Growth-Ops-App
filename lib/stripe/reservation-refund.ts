import { stripeGet, stripePost, type StripeAuth } from './client'

export type ReservationRefundRequest = {
  id: string
  tenant_id: string
  sale_id: string
  charge_id: string
  stripe_account_id: string
  amount_cents: number
  status: 'requested' | 'pending' | 'succeeded' | 'failed'
  stripe_refund_id: string | null
  created_at: string
}
type ProviderRefund = {
  id: string
  charge: string
  amount: number
  currency: string
  status: string
  created: number
  metadata?: { reservation_refund_request?: string }
}

/** Durable request identity survives retries and process restarts. Never POST beyond Stripe's key retention. */
export async function executeReservationRefund(request: ReservationRefundRequest, auth: StripeAuth) {
  let refund: ProviderRefund | undefined
  if (request.stripe_refund_id) {
    refund = await stripeGet<ProviderRefund>(`refunds/${request.stripe_refund_id}`, new URLSearchParams(), auth, 8_000)
  } else {
    const list = await stripeGet<{ data: ProviderRefund[]; has_more: boolean }>(
      'refunds',
      new URLSearchParams({ charge: request.charge_id, limit: '100' }),
      auth,
      8_000
    )
    refund = list.data.find((r) => r.metadata?.reservation_refund_request === request.id)
    if (!refund) {
      if (list.has_more || list.data.length > 0)
        throw new Error('Este cobro tiene otras devoluciones. Requiere conciliación financiera.')
      const age = Date.now() - Date.parse(request.created_at)
      if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000)
        throw new Error('Solicitud sin resultado confirmado. Revisa Stripe antes de volver a solicitar dinero.')
      refund = await stripePost<ProviderRefund>(
        'refunds',
        new URLSearchParams({
          charge: request.charge_id,
          amount: String(request.amount_cents),
          reason: 'requested_by_customer',
          'metadata[reservation_refund_request]': request.id,
        }),
        auth,
        `reservation-refund-${request.id}`,
        8_000
      )
    }
  }
  if (
    refund.metadata?.reservation_refund_request !== request.id ||
    refund.charge !== request.charge_id ||
    refund.amount !== Number(request.amount_cents) ||
    refund.currency !== 'eur' ||
    !/^re_[A-Za-z0-9]+$/.test(refund.id)
  )
    throw new Error('La devolución de Stripe no coincide con la reserva. Requiere conciliación.')
  return refund
}
