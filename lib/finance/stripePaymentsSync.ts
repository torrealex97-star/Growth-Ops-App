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
import { fetchStripeFeesForChargeIds } from './stripeFees'
import { ultimaDevolucionPorPago, type StripeRefundLite } from './refundDates'

export type StripePaymentsSyncResult = {
  /** Pagos vistos en esta pasada (los que entraron o se refrescaron). */
  written: number
  /** `true` = quedaban más pagos por leer en Stripe; se completará en la siguiente ejecución. */
  truncated: boolean
  pages: number
  /** Pagos con devolución total o parcial detectada en esta pasada. */
  refunded: number
  /** Fees que quedaron pendientes por presupuesto (se completan en la siguiente ejecución). */
  feesPendientes: number
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
    | {
        id?: string
        amount_refunded?: number | null
        refunded?: boolean | null
        disputed?: boolean | null
        billing_details?: { email?: string | null } | null
      }
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
        // `receipt_email` solo existe si Stripe mandó recibo; en producción venía vacío en TODOS los
        // pagos, así que el espejo no sabía de quién era ninguno. El correo de facturación del cargo
        // (ya expandido) es el mismo respaldo que usa el registrador (stripeBackfill.emailOf).
        customer_email: (i.receipt_email || charge?.billing_details?.email || '').trim().toLowerCase() || null,
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
  // equipo es el comisionable MENOS este fee, y el motor la lee del espejo. Presupuesto REAL:
  // el deadline solo cubría la paginación — el bucle de fees (secuencial, hasta 20 s por
  // llamada) y el upsert iban después sin presupuesto: una muerte por maxDuration perdía la
  // página entera y el reintento empezaba de cero. Ahora el bucle consulta el reloj antes de
  // cada llamada y el upsert del dinero se garantiza ANTES del corte.
  const chargeIds = filasBase.filter((f) => f.charge_id).map((f) => f.charge_id as string)

  // Fees que el espejo YA tiene: el fee de un charge es inmutable en Stripe, re-leerlo de la
  // API cada día es presupuesto quemado. Una lectura del estado previo ahorra el bucle entero
  // cuando no hay pagos nuevos (el caso común). Fail-ruidoso: sin este dato no se puede
  // decidir qué pedir ni qué conservar.
  const yaConFee = new Set<string>()
  for (let i = 0; i < chargeIds.length; i += 200) {
    const loteIds = chargeIds.slice(i, i + 200)
    if (loteIds.length === 0) continue
    const { data: previos, error } = await sb
      .from('stripe_payments')
      .select('charge_id')
      .eq('tenant_id', tenantId)
      .not('stripe_fee', 'is', null)
      .in('charge_id', loteIds)
    if (error) throw new Error(`No se pudo leer el estado de fees del espejo: ${error.message}`)
    for (const r of previos ?? []) if (r.charge_id) yaConFee.add(r.charge_id)
  }

  const { fees: feesDeStripe, deadlineReached } = await fetchStripeFeesForChargeIds(
    stripeSecretKey,
    stripeAccountId,
    chargeIds,
    { deadline: opts.deadline, yaConFee, maxFees: 200 }
  )

  // Persistencia INCREMENTAL garantizada: el dinero de la página leída se escribe SIEMPRE
  // (idempotente por (tenant_id, payment_id), refresca refunded_amount/status). El fee solo
  // se toca cuando se sabe su valor; si la lectura falló o el presupuesto se agotó, la clave
  // NO se incluye → PostgREST no toca la columna en el conflicto (conserva el fee del espejo)
  // y en filas nuevas queda NULL (el motor usa su fallback). Nunca se pisa un fee bueno con
  // null por una lectura caída, y lo pendiente se retoma en la siguiente ejecución.
  let feesPendientes = 0
  const filas = filasBase.map((f) => {
    const feeDeEste = f.charge_id ? feesDeStripe.get(f.charge_id) : undefined
    const yaTenia = f.charge_id != null && yaConFee.has(f.charge_id)
    const fila = { ...f } as (typeof filasBase)[number] & { stripe_fee?: number | null }
    if (feeDeEste != null) {
      fila.stripe_fee = feeDeEste
    } else if (!yaTenia) {
      if (!deadlineReached) fila.stripe_fee = null
      else feesPendientes++
    }
    return fila
  })

  // FECHA DE LA DEVOLUCIÓN (F05). Solo se pide la lista de refunds si hay algún pago devuelto. Si la
  // lectura falla o queda recortada, `refunded_at` NO se incluye en la fila (PostgREST no toca la
  // columna): se conserva lo que ya hubiera en el espejo en vez de pisarlo con null.
  let fechasDevolucion: Map<string, string> | null = null
  if (filas.some((f) => f.refunded_amount > 0)) {
    try {
      const refundsRes = await stripeList<StripeRefundLite>(
        'refunds',
        new URLSearchParams({ limit: '100' }),
        { secretKey: stripeSecretKey, accountId: stripeAccountId },
        { maxPages: 10, deadline: opts.deadline }
      )
      if (!refundsRes.truncated) fechasDevolucion = ultimaDevolucionPorPago(refundsRes.items)
    } catch {
      fechasDevolucion = null
    }
  }
  const filasConFecha = filas.map((f) => {
    if (!fechasDevolucion) return f
    if (f.refunded_amount <= 0) return { ...f, refunded_at: null as string | null }
    const cuando = fechasDevolucion.get(f.payment_id)
    return cuando ? { ...f, refunded_at: cuando } : f
  })

  // UPSERT por (tenant_id, payment_id): reejecutar nunca duplica; refresca refunded_amount/status
  // por si la devolución llegó entre ejecuciones y el webhook no pudo escribir el espejo.
  let written = 0
  const CHUNK = 200
  // Filas con y sin `refunded_at` van en upserts SEPARADOS: en un upsert masivo, una clave ausente en
  // unas filas y presente en otras se rellena con null y pisaría la fecha que el espejo ya tiene.
  const grupos = [filasConFecha.filter((f) => 'refunded_at' in f), filasConFecha.filter((f) => !('refunded_at' in f))]
  for (const grupo of grupos) {
    for (let i = 0; i < grupo.length; i += CHUNK) {
      const lote = grupo.slice(i, i + CHUNK)
      if (lote.length === 0) continue
      const { error } = await sb.from('stripe_payments').upsert(lote, { onConflict: 'tenant_id,payment_id' })
      if (error) throw new Error(error.message)
      written += lote.length
    }
  }

  return {
    written,
    truncated: truncated || deadlineReached,
    pages,
    refunded: filas.filter((f) => f.refunded_amount > 0).length,
    feesPendientes,
  }
}
