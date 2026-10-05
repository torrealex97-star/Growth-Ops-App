import { stripeGet, type StripeAuth } from './client'
import type { PaymentEvidence } from '@/lib/sales/payment-recognition'

type Ref = string | { id: string } | null
const id = (value: Ref | undefined) => (typeof value === 'string' ? value : (value?.id ?? null))
type Line = { price?: Ref; pricing?: { price_details?: { price?: Ref } }; period?: { end?: number } }
type Invoice = {
  id: string
  billing_reason?: string
  subscription?: Ref
  parent?: { subscription_details?: { subscription?: Ref } }
  lines?: { data: Line[]; has_more?: boolean }
}
type Intent = { invoice?: Ref; customer?: Ref; currency?: string }
type Session = { id: string; payment_status?: string; mode?: string; subscription?: Ref }
type Subscription = {
  status?: string
  cancel_at_period_end?: boolean
  current_period_end?: number
  items?: { data: { current_period_end?: number }[] }
}
/** Read only a bounded set of linked objects, not the customer's whole Stripe history. */
export async function readPaymentEvidence(paymentId: string, auth: StripeAuth): Promise<PaymentEvidence> {
  const result: PaymentEvidence = {
    priceId: null,
    subscriptionId: null,
    recurring: false,
    firstPayment: false,
    nextPaymentDate: null,
    subscriptionStatus: null,
    cancelAtPeriodEnd: false,
    warning: null,
  }
  // All requests share a wall-clock budget, including retries/fallbacks.
  const deadline = Date.now() + 14000
  const get = <T>(path: string, params = new URLSearchParams()) =>
    stripeGet<T>(path, params, auth, Math.max(1, deadline - Date.now()))
  // Estado vivo de la suscripción: no basta con saber que el cobro es recurrente. La bandeja
  // debe poder decir si sigue activa, hasta cuándo (periodo en curso) y si va a cancelarse
  // (cancel_at_period_end) sin salir de la app ni abrir Stripe.
  const readSubscription = async (subscriptionId: string) => {
    const sub = await get<Subscription>(`subscriptions/${encodeURIComponent(subscriptionId)}`)
    result.subscriptionStatus = sub.status ?? null
    result.cancelAtPeriodEnd = !!sub.cancel_at_period_end
    const end =
      sub.current_period_end ?? (sub.items?.data.length === 1 ? sub.items.data[0].current_period_end : undefined)
    if (end && end * 1000 > Date.now()) result.nextPaymentDate = new Date(end * 1000).toISOString().slice(0, 10)
  }
  try {
    const intent = await get<Intent>(`payment_intents/${encodeURIComponent(paymentId)}`)
    if (intent.currency && intent.currency.toLowerCase() !== 'eur') throw new Error('currency needs review')
    let invoiceId = id(intent.invoice)
    if (!invoiceId) {
      const links = await get<{ data: { invoice: Ref }[]; has_more?: boolean }>(
        'invoice_payments',
        new URLSearchParams({
          'payment[type]': 'payment_intent',
          'payment[payment_intent]': paymentId,
          status: 'paid',
          limit: '2',
        })
      )
      if (links.has_more || links.data.length > 1) throw new Error('ambiguous invoices')
      invoiceId = id(links.data[0]?.invoice)
    }
    let lines: { data: Line[]; has_more?: boolean } | undefined
    if (invoiceId) {
      const invoice = await get<Invoice>(`invoices/${encodeURIComponent(invoiceId)}`)
      result.subscriptionId = id(invoice.subscription) ?? id(invoice.parent?.subscription_details?.subscription)
      result.recurring =
        invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_update'
      result.firstPayment = invoice.billing_reason === 'subscription_create'
      if (invoice.billing_reason === 'subscription_update') {
        result.warning = 'Stripe indica un cambio de suscripción. Revisa ajustes y prorrateos antes de registrar.'
        return result
      }
      lines = invoice.lines
      if (result.subscriptionId) await readSubscription(result.subscriptionId)
    } else {
      const sessions = await get<{ data: Session[]; has_more?: boolean }>(
        'checkout/sessions',
        new URLSearchParams({ payment_intent: paymentId, limit: '2' })
      )
      if (sessions.has_more || sessions.data.length !== 1) return result
      const session = sessions.data[0]
      if (session.payment_status !== 'paid') return result
      lines = await get<{ data: Line[]; has_more?: boolean }>(
        `checkout/sessions/${encodeURIComponent(session.id)}/line_items`,
        new URLSearchParams({ limit: '2' })
      )
      result.subscriptionId = id(session.subscription)
      // A subscription-mode Checkout creates the subscription: its invoice is the first one.
      if (session.mode === 'subscription') result.firstPayment = true
      if (result.subscriptionId) await readSubscription(result.subscriptionId)
      // A one-time Checkout can also be a later instalment; it is not proof of a first purchase.
    }
    // Multiple items, prorations or truncated lines must not silently pick the first product.
    if (lines?.has_more || lines?.data.length !== 1) {
      result.warning = 'Stripe contiene varias líneas o una factura incompleta. Revisa la compra antes de asociarla.'
      return result
    }
    result.priceId = id(lines.data[0].price) ?? id(lines.data[0].pricing?.price_details?.price)
    return result
  } catch {
    return {
      ...result,
      priceId: null,
      warning: 'No se pudo completar el reconocimiento en Stripe. Puedes reintentar o revisar el cobro manualmente.',
    }
  }
}
