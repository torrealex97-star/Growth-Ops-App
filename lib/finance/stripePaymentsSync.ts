// SYNC DE PAGOS DE STRIPE — la mitad PULL de la fuente primaria de Cash Collected.
//
// QUÉ ES. El webhook (lib/stripe/webhook.ts) es la mitad push: registra eventos en crudo, pero a
// propósito NO escribe dinero en ninguna tabla de negocio. Este módulo es la otra mitad: lee
// PaymentIntents de la API de Stripe y mantiene `stripe_payments` (el espejo que alimenta el cash
// canónico de lib/canonical/cash.ts). Push y pull se necesitan: el push es inmediato pero frágil
// (se pierde si el endpoint cae), el pull es completo pero diferido.
//
// REGLAS DE INGESTA, heredadas del webhook para que push y pull NUNCA discrepen:
//   · El PaymentIntent es el evento canónico del dinero: los charge.directos sin intent no se
//     alcanzan por esta vía (y si existen, su webhook sí los guarda como cobro).
//   · Solo `succeeded` entra: pending/failed/void NO son cash (§2).
//   · La devolución vive DENTRO del pago (`refunded_amount`), nunca como fila aparte: restar filas
//     partiría la unidad de evento y complicaría el netting (§2: los refunds restan una vez).
//   · Upsert idempotente por (tenant_id, payment_id): reejecutar el sync es inofensivo.
//
// Paginación con presupuesto (stripeList): una ejecución de 60 s no se come años de historial sin
// decirlo — `truncated` sube y el panel lo declara en vez de vender media lista como completa.

import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeList } from '@/lib/stripe/client'
import { fetchStripeFeeForCharge } from './stripeFees'

export type StripePaymentsSyncResult = {
  /** Pagos vistos en esta pasada (los que entraron o se refrescaron). */
  written: number
  /** `true` = quedaban más pagos por leer en Stripe; se completará en la siguiente ejecución. */
  truncated: boolean
  pages: number
  /** Pagos con devolución total o parcial detectada en esta pasada. */
  refunded: number
}

type StripeIntentRow = {
  id: string
  amount_received?: number | null
  amount?: number | null
  currency?: string | null
  created?: number | null
  status?: string | null
  customer?: string | null
  receipt_email?: string | null
  metadata?: Record<string, string> | null
  latest_charge?:
    | string
    | { id?: string; amount_refunded?: number | null; refunded?: boolean | null; disputed?: boolean | null }
    | null
}

/** Centimos → euros con redondeo a 2 decimales (Stripe solo habla de la unidad mínima). */
const aEuros = (cent: number | null | undefined): number => Math.round(Number(cent ?? 0)) / 100

/**
 * Sincroniza los PaymentIntents liquidados de la cuenta de Stripe del tenant al espejo
 * `stripe_payments`. Requiere el client de servicio (el cron y las rutas admin lo crean): RLS
 * bloquearía la escritura de un client de usuario, y el sync es una operación del sistema.
 */
export async function syncStripePayments(
  sb: SupabaseClient,
  tenantId: string,
  stripeSecretKey: string,
  stripeAccountId?: string | null,
  opts: { maxPages?: number; deadline?: number } = {}
): Promise<StripePaymentsSyncResult> {
  const query = new URLSearchParams({ limit: '100' })
  query.append('expand[]', 'data.latest_charge')

  const {
    items: intents,
    truncated,
    pages,
  } = await stripeList<StripeIntentRow>(
    'payment_intents',
    query,
    { secretKey: stripeSecretKey, accountId: stripeAccountId },
    { maxPages: opts.maxPages ?? 20, deadline: opts.deadline }
  )

  const filasBase = intents
    .filter((i) => i.status === 'succeeded' && !!i.id)
    .map((i) => {
      const charge = typeof i.latest_charge === 'object' ? i.latest_charge : null
      const bruto = aEuros(i.amount_received ?? i.amount)
      // Devolución: amount_refunded del cargo. `refunded=true` sin amount_refunded → devolución total.
      const devuelto = charge?.refunded && !charge.amount_refunded ? bruto : aEuros(charge?.amount_refunded ?? 0)
      const estado = charge?.disputed
        ? 'disputed'
        : devuelto >= bruto && devuelto > 0
          ? 'refunded'
          : devuelto > 0
            ? 'partially_refunded'
            : 'succeeded'
      return {
        tenant_id: tenantId,
        payment_id: i.id!,
        charge_id: charge?.id ?? (typeof i.latest_charge === 'string' ? i.latest_charge : null),
        customer_id: i.customer ?? null,
        customer_email: i.receipt_email ?? null,
        amount: bruto,
        refunded_amount: Math.min(devuelto, bruto),
        currency: (i.currency ?? 'eur').toLowerCase(),
        status: estado,
        // La marca de Stripe (created), no la del sync: es la que sitúa el cash en el periodo.
        paid_at: i.created ? new Date(i.created * 1000).toISOString() : null,
        metadata: i.metadata ?? null,
      }
    })

  // FEE REAL por pago (balance_transaction del charge): la base de comisión de todo el
  // equipo es el comisionable MENOS este fee, y el motor la lee del espejo. Un fallo o un
  // fee no disponible deja `stripe_fee` NULL (el motor usa su fallback) — nunca bloquea el sync.
  const filas = []
  for (const fila of filasBase) {
    const stripe_fee = fila.charge_id ? await fetchStripeFeeForCharge(stripeSecretKey, stripeAccountId, fila.charge_id) : null
    filas.push({ ...fila, stripe_fee })
  }

  // UPSERT por (tenant_id, payment_id): reejecutar nunca duplica; refresca refunded_amount/status
  // por si la devolución llegó entre ejecuciones y el webhook no pudo escribir el espejo.
  let written = 0
  const CHUNK = 200
  for (let i = 0; i < filas.length; i += CHUNK) {
    const lote = filas.slice(i, i + CHUNK)
    if (lote.length === 0) continue
    const { error } = await sb.from('stripe_payments').upsert(lote, { onConflict: 'tenant_id,payment_id' })
    if (error) throw new Error(error.message)
    written += lote.length
  }

  return {
    written,
    truncated,
    pages,
    refunded: filas.filter((f) => f.refunded_amount > 0).length,
  }
}
