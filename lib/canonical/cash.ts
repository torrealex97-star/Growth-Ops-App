// ─────────────────────────────────────────────────────────────────────────────
// CASH CANÓNICO (§2 de la spec del dashboard global)
// ─────────────────────────────────────────────────────────────────────────────
// cash_collected = dinero EFECTIVAMENTE cobrado. Fuente primaria: Stripe
// (stripe_payments); fallback: los cobros internos de `collections` que Stripe
// no ve (transferencias, SeQura, registro manual) y el registro manual.
//
// REGLA DE ORO: las dos listas NUNCA se suman a ciegas. Un pago registrado en
// `collections` con `payment_reference` = id de Stripe es EL MISMO dinero que el
// intent de Stripe: cuenta una vez, y gana la fuente primaria. El desglose por
// fuente queda en el resultado para que la UI pueda mostrar la partida al
// completo (§19: conflicto registrado, nunca resuelto en silencio).
//
// RESTO DE DEVOLUCIONES (§2): los refunds RESTAN del cash según la lógica
// financiera ya asentada en el resto del sistema — una devolución sobre un cobro
// de Stripe es `refunded_amount` del propio pago; una sobre un cobro interno es
// una fila `refunds` (o `collections` en 'reversed'), y resta del total. Lo que
// NUNCA hace este módulo es devolver el dinero dos veces: el reembolso pertenece
// al pago al que reembolsa, y si ese pago ya salió del cash (fallback ganado por
// primaria), su refund sale con él.
//
// Función PURA: recibe filas ya traídas y devuelve el consolidado + diagnóstico.
// Testeable sin BD (ver tests/canonical/cash.test.mjs).

// ── Entradas ────────────────────────────────────────────────────────────────

/** Fila del espejo stripe_payments (fuente primaria). PostgREST manda NUMERIC como string: num() tolera ambos. */
export type StripePaymentRow = {
  payment_id: string
  charge_id: string | null
  amount: number | string | null
  refunded_amount: number | string | null
  status: string
  paid_at: string | null
  customer_email: string | null
}

/** Fila de collections (fallback) ya recortada a lo que el cash necesita. */
export type InternalCollectionRow = {
  id: string
  /** `payment_reference` — aquí es donde vive el id de Stripe si el cobro vino de ahí. */
  payment_reference: string | null
  gross_amount: number
  status: string
  collected_at: string | null
}

/** Fila de refunds sobre cobros internos (la tabla `refunds`). */
export type InternalRefundRow = {
  collection_id: string | null
  refund_date: string | null
  gross_refund_amount: number
  status: string
}

// ── Resultado ───────────────────────────────────────────────────────────────

export type CashBreakdown = {
  /** Dinero cobrado NETO del periodo: cobros − devoluciones (§2). */
  net: number
  /** Cobros brutos antes de restar devoluciones. */
  gross: number
  /** Devoluciones restadas (siempre >= 0). */
  refunds: number
  /** Qué parte del neto viene de cada fuente. Se suman EXACTAS al neto. */
  bySource: { stripe: number; internal: number }
  /** Diagnóstico de calidad (§19/§20/§38): nada silencioso. */
  duplicatedPayments: number
  /** Cobros internos que Stripe también vio, con importe DISTINTO: la primaria gana, pero queda registrado. */
  amountConflicts: { paymentId: string; stripe: number; internal: number }[]
}

const num = (x: number | string | null | undefined): number => Number(x ?? 0)

// El mismo dinero entre fuentes: payment_reference de collections == payment_id
// (o charge_id) de Stripe. Es la dedupKey que declara el registro (§2):
// transaction_id/payment_id primero; sin referencia no hay cruce posible y la
// fila interna entra como dinero propio del fallback.
function mismaReferenciaStripe(ref: string | null | undefined, sp: StripePaymentRow): boolean {
  if (!ref) return false
  return ref === sp.payment_id || (sp.charge_id != null && ref === sp.charge_id)
}

/**
 * Consolidado de Cash Collected (§2) sobre un periodo YA FILTRADO: las filas que
 * llegan aquí deben estar acotadas por fecha por quien llama (la función es pura
 * y no sabe de periodos; la ventana la aplica la página con sus filtros).
 *
 * Orden de resolución (registry: stripe > internal_payments > manual):
 *  1. Cada pago de Stripe con `amount_received` entra por la primaria, NETO de su
 *     propia devolución (`refunded_amount`).
 *  2. Cada cobro interno 'collected' con `payment_reference` que casé con un pago
 *     de Stripe se DESCARTA como duplicado (misma referencia = mismo dinero);
 *     si además el importe difiere, el conflicto queda en `amountConflicts`.
 *  3. Los cobros internos que Stripe no ve (sin referencia cruzada) entran como
 *     fallback: transferencias, SeQura, manual.
 *  4. Las devoluciones internas (`refunds` 'processed' sobre cobros que siguen en
 *     el cash, y `collections` 'reversed') restan del total.
 */
export function canonicalCash(
  stripePayments: StripePaymentRow[],
  collections: InternalCollectionRow[],
  internalRefunds: InternalRefundRow[] = []
): CashBreakdown {
  let grossStripe = 0
  let netStripe = 0
  let refundStripe = 0

  // 1. Primaria: cada pago de Stripe cuenta una vez (la tabla ya es unique por
  // (tenant, payment_id); el merge defensivo por payment_id cubre dobles filas
  // que llegaran por una consulta mal montada).
  const stripeVistos = new Set<string>()
  for (const sp of stripePayments) {
    if (!sp.payment_id || stripeVistos.has(sp.payment_id)) continue
    stripeVistos.add(sp.payment_id)
    const bruto = num(sp.amount)
    const devuelto = Math.min(num(sp.refunded_amount), bruto)
    grossStripe += bruto
    refundStripe += devuelto
    netStripe += bruto - devuelto
  }

  // 2. Fallback: cobros internos. Los que cruzan con Stripe se descartan como
  // duplicado; si el importe difiere, el conflicto queda registrado.
  const duplicatedPayments: string[] = []
  const amountConflicts: { paymentId: string; stripe: number; internal: number }[] = []
  let grossInternal = 0
  let refundInternal = 0

  // Cobros internos que SOBREVIVEN (entran al cash): se necesitan para saber
  // qué refunds internos restan de verdad.
  const vivas = new Set<string>()

  for (const c of collections) {
    const bruto = num(c.gross_amount)
    const esCobrado = c.status === 'collected'

    if (esCobrado) {
      const cruze = stripePayments.find((sp) => mismaReferenciaStripe(c.payment_reference, sp))
      if (cruze) {
        // EL MISMO dinero: cuenta UNA vez y gana la primaria (§2/§19).
        duplicatedPayments.push(c.id)
        const importeStripe = num(cruze.amount)
        if (Math.abs(importeStripe - bruto) >= 0.01) {
          amountConflicts.push({ paymentId: cruze.payment_id, stripe: importeStripe, internal: bruto })
        }
        continue
      }
      // Cobro interno sin counterpart en Stripe: transferencia, SeQura, manual…
      vivas.add(c.id)
      grossInternal += bruto
    }
    // 'reversed' / 'disputed' / cualquier otro estado NO suma NI resta: el reverso es la MISMA
    // fila que en su día sumó como 'collected' (los flujos de la app actualizan el status, nunca
    // insertan una fila de reverso aparte) — restar aquí sería devolver dinero dos veces. La
    // devolución real de un pago de Stripe vive en su refunded_amount; la de un cobro interno,
    // en la tabla refunds (que resta solo sobre filas 'collected' vivas).
    // 'disputed': en disputa NO es cash confirmado ni devuelto; ni suma ni resta
    // hasta que se resuelva (§2: excluir pending/failed/void).
  }

  // 3. Devoluciones internas (tabla refunds) sobre cobros que siguen en el cash.
  // Un refund sobre un cobro que ya salió (reversed/disputado) no puede restar
  // dos veces: solo cuenta si su collection sigue viva.
  for (const r of internalRefunds) {
    if (r.status !== 'processed') continue // pending/rejected no mueven cash aún
    if (r.collection_id && vivas.has(r.collection_id)) {
      refundInternal += num(r.gross_refund_amount)
    }
  }

  const gross = grossStripe + grossInternal
  const refundsTotal = refundStripe + refundInternal
  const net = gross - refundsTotal

  return {
    net,
    gross,
    refunds: refundsTotal,
    bySource: {
      stripe: netStripe,
      internal: grossInternal - refundInternal,
    },
    duplicatedPayments: duplicatedPayments.length,
    amountConflicts,
  }
}
