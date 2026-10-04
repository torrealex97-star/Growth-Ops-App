/** Evidence-based suggestions only. A suggestion never records money. */
export type PaymentEvidence = {
  priceId: string | null
  subscriptionId: string | null
  recurring: boolean
  firstPayment: boolean
  nextPaymentDate: string | null
  warning: string | null
}
export type RecognitionSale = {
  id: string
  product_id: string | null
  payment_plan_id: string | null
  gross_amount: number
  sale_date: string
  collected: number
  method: string | null
}
export type RecognitionPlan = {
  id: string
  product_id: string
  gross_price: number
  number_of_payments: number
  method: string | null
}
export function suggestPayment(
  evidence: PaymentEvidence,
  mapped: { productId: string; paymentPlanId: string } | null,
  sales: RecognitionSale[],
  plans: RecognitionPlan[],
  amount: number,
  paidAt: string | null
) {
  const result = {
    mode: '' as '' | 'new' | 'existing' | 'reservation',
    saleId: null as string | null,
    productId: null as string | null,
    planId: null as string | null,
    remainingCount: null as number | null,
    nextPaymentDate: evidence.nextPaymentDate,
    reason: evidence.warning ?? 'No hay evidencia suficiente para identificar la compra. Revisa las opciones.',
  }
  if (evidence.warning) return result
  if (!mapped) {
    // Sin Price ID mapeado no se inventa producto. Única excepción honesta: un ÚNICO plan de
    // reserva activo cuyo importe coincide exactamente con el cobro — se SUGIERE y el usuario
    // confirma producto y plan antes de guardar; nunca se registra solo.
    if (!evidence.recurring && sales.length === 0) {
      const reservas = plans.filter(
        (p) => (p.method ?? '') === 'reserva' && Math.abs(Number(p.gross_price) - amount) <= 0.01
      )
      if (reservas.length === 1) {
        result.mode = 'reservation'
        result.productId = reservas[0].product_id
        result.planId = reservas[0].id
        result.reason =
          'El importe coincide exactamente con un plan de reserva activo. Se sugiere registrarlo como reserva: confirma producto y plan.'
      }
    }
    return result
  }
  const plan = plans.find((p) => p.id === mapped.paymentPlanId && p.product_id === mapped.productId)
  if (!plan) return result
  result.productId = mapped.productId
  result.planId = plan.id
  const candidates = sales.filter(
    (s) =>
      s.product_id === mapped.productId &&
      s.sale_date.slice(0, 10) <= (paidAt?.slice(0, 10) ?? '') &&
      (s.payment_plan_id === plan.id || s.method === 'reserva') &&
      Number(s.method === 'reserva' ? plan.gross_price : s.gross_amount) - s.collected >= amount - 0.01
  )
  if (candidates.length === 1 && (!evidence.firstPayment || candidates[0].method === 'reserva')) {
    result.mode = candidates[0].method === 'reserva' ? 'reservation' : 'existing'
    result.saleId = candidates[0].id
    result.reason =
      'Producto y plan reconocidos en Stripe. Hay una venta compatible con saldo pendiente: confirma que corresponde a esta compra.'
    return result
  }
  if ((plan.method ?? '') === 'reserva') {
    // Un cobro cuyo Price ID apunta al plan de reserva ES un anticipo: se propone como reserva
    // (nueva o de una reserva abierta que elige la UI), nunca como venta nueva ni cuota. Va antes
    // del guard de "ya tiene ventas": que el contacto haya comprado antes no cambia que ESTE cobro
    // esté identificado como reserva por su Price ID.
    result.mode = 'reservation'
    result.reason = evidence.recurring
      ? 'El Price ID corresponde al plan de reserva. Confirma que este cobro recurrente es el anticipo de una reserva.'
      : 'Plan de reserva reconocido en Stripe. Puedes registrarlo como reserva nueva o añadirlo a una reserva abierta del contacto.'
    return result
  }
  if (sales.length || evidence.recurring) {
    result.reason = evidence.recurring
      ? 'Stripe identifica un cobro recurrente. Vincúlalo a la compra original; no se propone una venta nueva.'
      : 'El contacto ya tiene ventas. Confirma la compra para evitar registrar una cuota como venta nueva.'
    return result
  }
  if ((plan.method ?? '') === 'sequra') {
    result.reason = 'Plan reconocido. La financiación externa requiere su flujo específico.'
    return result
  }
  if (Number(plan.gross_price) < amount - 0.01) {
    result.reason = 'El cobro supera el total del plan reconocido. Revisa descuentos, moneda y producto.'
    return result
  }
  result.mode = 'new'
  result.reason = 'Producto y plan reconocidos por el precio de Stripe. No hay ventas previas de este contacto.'
  // The count comes from the agreed plan, never from total / receipt. Only the first payment establishes it.
  if (evidence.firstPayment && Number.isInteger(plan.number_of_payments) && plan.number_of_payments > 1)
    result.remainingCount = plan.number_of_payments - 1
  if (Math.abs(Number(plan.gross_price) - amount) <= 0.01) result.remainingCount = 0
  return result
}
