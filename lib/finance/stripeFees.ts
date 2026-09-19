// FEE REAL DE STRIPE — la pieza que falta para la base de comisión neta.
//
// El fee de un pago vive en su balance_transaction (net = gross − fee), no en el
// PaymentIntent. El espejo `stripe_payments` lo guarda en `stripe_fee` (migración
// 20260919100000); este módulo lo trae de la API cuando hace falta:
//
//   · El SYNC (stripePaymentsSync) lo pide en bloque para los pagos que ya toca —
//     una segunda lista con `transfer_data` no hace falta: se consulta el endpoint
//     de balance_transactions por charge.
//   · El MOTOR de comisiones lo pide PUNTUAL (pull bajo demanda) cuando un cobro
//     trae `payment_reference` que el espejo aún no conoce: mejor una lectura
//     pequeña ahora que mostrar una comisión sobre bruto hasta el próximo cron.
//
// Robustez: un fallo de Stripe jamás bloquea un cobro — el llamador usa su fallback
// (fee del plan) y el sync diario cuadra el espejo.

import { stripeGet } from '@/lib/stripe/client'

type BalanceTxn = {
  id: string
  /** Neto en céntimos: gross − fee. Solo informativo aquí. */
  net?: number | null
  fee?: number | null
  /** Detalle de la comisión por concepto (p.ej. `stripe_fee`). */
  fee_details?: { amount?: number | null; type?: string | null }[] | null
  source?: string | null
}

const aEuros = (cent: number | null | undefined): number => Math.round(Number(cent ?? 0)) / 100

function feeDeTxn(txn: BalanceTxn | null | undefined): number | null {
  if (!txn) return null
  if (Array.isArray(txn.fee_details) && txn.fee_details.length) {
    const total = txn.fee_details.reduce((s, d) => s + Number(d.amount ?? 0), 0)
    return aEuros(total)
  }
  return txn.fee != null ? aEuros(txn.fee) : null
}

/**
 * Lee el balance_transaction de cada charge/pago y devuelve `referencia → fee en euros`.
 * Acepta tanto `pi_...` como `ch_...`: el pago (expandiendo `latest_charge`) o el charge
 * directo. Una referencia que Stripe no encuentra vuelve sin fee (el llamador usa fallback).
 */
export async function fetchStripeFeesForReferences(
  secretKey: string,
  accountId: string | null | undefined,
  referencias: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const auth = { secretKey, accountId }

  for (const ref of referencias.slice(0, 50)) {
    try {
      if (ref.startsWith('pi_')) {
        // Pago: expandimos su charge y de ahí su balance_transaction.
        const intent = await stripeGet<{ latest_charge?: string | { id?: string } | null }>(
          'payment_intents/' + encodeURIComponent(ref),
          new URLSearchParams({ 'expand[]': 'latest_charge.balance_transaction' }),
          auth
        )
        const chargeId = typeof intent.latest_charge === 'object' ? intent.latest_charge?.id : intent.latest_charge
        if (!chargeId) continue
        const charge = await stripeGet<{
          balance_transaction?: string | { fee?: number | null; fee_details?: BalanceTxn['fee_details'] } | null
        }>('charges/' + encodeURIComponent(chargeId), new URLSearchParams({ 'expand[]': 'balance_transaction' }), auth)
        const fee = feeDeTxn(
          typeof charge.balance_transaction === 'object' ? (charge.balance_transaction as BalanceTxn) : null
        )
        if (fee != null) out.set(ref, fee)
      } else if (ref.startsWith('ch_')) {
        const charge = await stripeGet<{
          balance_transaction?: string | { fee?: number | null; fee_details?: BalanceTxn['fee_details'] } | null
        }>('charges/' + encodeURIComponent(ref), new URLSearchParams({ 'expand[]': 'balance_transaction' }), auth)
        const fee = feeDeTxn(
          typeof charge.balance_transaction === 'object' ? (charge.balance_transaction as BalanceTxn) : null
        )
        if (fee != null) out.set(ref, fee)
      }
    } catch {
      // Pago inexistente, clave sin permisos o Stripe caído: sin fee para esta referencia.
      continue
    }
  }
  return out
}

/** Versión por charge_id para el sync (ya tiene el charge expandido, solo falta el balance). */
export async function fetchStripeFeeForCharge(
  secretKey: string,
  accountId: string | null | undefined,
  chargeId: string
): Promise<number | null> {
  if (!chargeId) return null
  try {
    const auth = { secretKey, accountId }
    const charge = await stripeGet<{
      balance_transaction?: string | { fee?: number | null; fee_details?: BalanceTxn['fee_details'] } | null
    }>('charges/' + encodeURIComponent(chargeId), new URLSearchParams({ 'expand[]': 'balance_transaction' }), auth)
    return feeDeTxn(typeof charge.balance_transaction === 'object' ? (charge.balance_transaction as BalanceTxn) : null)
  } catch {
    return null
  }
}
