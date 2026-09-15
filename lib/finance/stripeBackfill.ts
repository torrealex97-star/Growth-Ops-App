// Informe de backfill de Stripe: qué pagos históricos NO están registrados como venta, y por qué.
//
// ES UN INFORME, NO UN IMPORTADOR, y no por prudencia excesiva: `sales.product_id` y
// `sales.payment_plan_id` son NOT NULL, y un pago de Stripe no dice a qué producto interno
// corresponde ni cuál es la política de reembolso. Crear ventas automáticamente exigiría ELEGIR un
// producto y un plan — es decir, inventar datos financieros. Este informe dice exactamente qué falta
// y qué decisión hace falta para cada caso; la toma una persona.
//
// LA REGLA ACORDADA: un cliente sin pagos exitosos NO es una venta. Aquí se aplica al pago, que es
// el hecho: un intento pendiente, fallido o cancelado no es dinero, y un reembolso total tampoco.
import type { StripeIntent } from '@/lib/finance/stripeReconciliation'

type BackfillVerdict =
  | 'ya_registrado' // ya hay un cobro interno para este pago
  | 'registrable' // pago bueno y contacto identificado: falta decidir producto y plan
  | 'sin_contacto' // pago bueno pero no hay contacto interno con ese email
  | 'no_es_venta' // no hubo pago exitoso: no es una venta
  | 'reembolsado' // cobrado y devuelto entero: no es ingreso

export type BackfillRow = {
  paymentId: string
  createdAt: string
  amount: number
  currency: string
  email: string | null
  verdict: BackfillVerdict
  /** Qué hace falta para registrarlo, o por qué no procede. Una frase, sin códigos. */
  reason: string
  contactId: string | null
}

export type BackfillContext = {
  /** Referencias de pago ya presentes en `collections` (intent id y charge id). */
  knownReferences: Set<string>
  /** email normalizado → contact_id. */
  contactsByEmail: Map<string, string>
}

const chargeOf = (intent: StripeIntent) => (typeof intent.latest_charge === 'object' ? intent.latest_charge : null)

function emailOf(intent: StripeIntent): string | null {
  const charge = chargeOf(intent)
  const raw = intent.receipt_email || charge?.billing_details?.email || null
  return raw ? raw.trim().toLowerCase() : null
}

export function classifyForBackfill(intent: StripeIntent, ctx: BackfillContext): BackfillRow {
  const charge = chargeOf(intent)
  const chargeId = charge?.id || (typeof intent.latest_charge === 'string' ? intent.latest_charge : null)
  const amount = intent.amount_received / 100
  const email = emailOf(intent)
  const base = {
    paymentId: intent.id,
    createdAt: new Date(intent.created * 1000).toISOString(),
    amount,
    currency: (intent.currency || '').toUpperCase(),
    email,
    contactId: email ? (ctx.contactsByEmail.get(email) ?? null) : null,
  }

  // 1) ¿Ya está registrado? Se comprueba primero: si hay cobro, no hay nada que decidir.
  const refs = [intent.id, chargeId].filter((v): v is string => !!v)
  if (refs.some((r) => ctx.knownReferences.has(r))) {
    return { ...base, verdict: 'ya_registrado', reason: 'Ya existe un cobro interno con esta referencia de pago.' }
  }

  // 2) LA REGLA: sin pago exitoso no hay venta. Un intento pendiente o fallido no es dinero.
  if (intent.status !== 'succeeded') {
    return {
      ...base,
      verdict: 'no_es_venta',
      reason: `El pago no se completó (estado "${intent.status}"), así que no es una venta.`,
    }
  }

  // 3) Devuelto entero: se cobró y se deshizo. No es ingreso, y registrarlo como venta activa
  //    inflaría la facturación con dinero que no está.
  const refunded = Number(charge?.amount_refunded || 0) / 100
  if (charge?.refunded === true || (amount > 0 && refunded >= amount - 0.01)) {
    return { ...base, verdict: 'reembolsado', reason: 'Se cobró y se devolvió por completo: no es ingreso.' }
  }

  // 4) Pago bueno sin contacto interno: no se puede atar a nadie sin crear un contacto, y crear
  //    contactos a partir de un email de facturación mezclaría la base de clientes con ruido.
  if (!base.contactId) {
    return {
      ...base,
      verdict: 'sin_contacto',
      reason: email
        ? `No hay ningún contacto con el email ${email}. Créalo o vincula el pago a mano.`
        : 'El pago no trae email, así que no se puede identificar al cliente.',
    }
  }

  return {
    ...base,
    verdict: 'registrable',
    reason: 'Pago correcto y cliente identificado. Falta elegir producto y plan de pago para registrarlo.',
  }
}

export type BackfillSummary = Record<BackfillVerdict, number> & { total: number; importe_registrable: number }

export function summarizeBackfill(rows: BackfillRow[]): BackfillSummary {
  const s: BackfillSummary = {
    total: rows.length,
    ya_registrado: 0,
    registrable: 0,
    sin_contacto: 0,
    no_es_venta: 0,
    reembolsado: 0,
    importe_registrable: 0,
  }
  for (const r of rows) {
    s[r.verdict]++
    // Solo suma lo que de verdad podría convertirse en venta: ni lo ya registrado, ni lo no pagado,
    // ni lo devuelto. Si sumara todo, el informe prometería una facturación que no existe.
    if (r.verdict === 'registrable') s.importe_registrable += r.amount
  }
  // Dos decimales: sumar céntimos en coma flotante arrastra error, y esto es dinero.
  s.importe_registrable = Math.round(s.importe_registrable * 100) / 100
  return s
}
