// FECHA DE LA DEVOLUCIÓN (F05 · MONEY D5): una devolución resta del cash cuando OCURRE.
//
// Stripe da `created` por cada refund. Un pago puede tener varios: el espejo guarda la ÚLTIMA fecha
// (`stripe_payments.refunded_at`). Puro: no sabe nada de la API ni de la base.

export type StripeRefundLite = {
  id: string
  payment_intent?: string | null
  created?: number | null
  status?: string | null
}

/** payment_intent → ISO de la última devolución EXITOSA. Los refunds fallidos/cancelados no cuentan. */
export function ultimaDevolucionPorPago(refunds: StripeRefundLite[]): Map<string, string> {
  const porPago = new Map<string, number>()
  for (const r of refunds) {
    if (!r.payment_intent || !r.created || r.status !== 'succeeded') continue
    const previo = porPago.get(r.payment_intent)
    if (previo === undefined || r.created > previo) porPago.set(r.payment_intent, r.created)
  }
  return new Map([...porPago].map(([pago, segundos]) => [pago, new Date(segundos * 1000).toISOString()]))
}
