// RECONOCIMIENTO DE PRODUCTO POR PRICE ID DE STRIPE — módulo puro (sin red ni DB), igual espíritu
// que lib/sales/payment-inbox.ts: la regla de negocio se prueba sola, la ruta solo la alimenta.
//
// De dónde sale el Price ID: un PaymentIntent suelto no lo trae, pero su factura (cuando el pago
// viene de una suscripción/plan de cuotas) sí — las facturas de Stripe siempre incluyen sus líneas,
// y cada línea trae el objeto `price` completo. Un Payment Link de un solo pago sin factura no
// tiene esta señal: en ese caso no hay nada que reconocer y la bandeja sigue pidiendo la elección
// manual de siempre.

export type PriceMapEntry = {
  stripePriceId: string
  productId: string
  paymentPlanId: string
}

export type PriceSuggestion = { productId: string; paymentPlanId: string } | null

/** El Price ID de la primera línea de una factura de Stripe, o null si no hay factura/líneas. */
export function firstInvoiceLinePriceId(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== 'object') return null
  const inv = invoice as { lines?: { data?: Array<{ price?: { id?: string } | string | null }> } }
  const primera = inv.lines?.data?.[0]
  const price = primera?.price
  if (!price) return null
  return typeof price === 'string' ? price : (price.id ?? null)
}

/**
 * Resuelve producto/plan por Price ID contra el mapeo del tenant. Sin Price ID o sin mapeo para
 * ese Price ID, no sugiere nada — nunca se adivina por importe ni por ninguna otra señal aquí.
 */
export function resolveByPriceId(stripePriceId: string | null, map: PriceMapEntry[]): PriceSuggestion {
  if (!stripePriceId) return null
  const hit = map.find((m) => m.stripePriceId === stripePriceId)
  return hit ? { productId: hit.productId, paymentPlanId: hit.paymentPlanId } : null
}
