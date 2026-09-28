// SUGERENCIA DE VENTA BORRADOR a partir de un pago de Stripe ya identificado por contacto.
//
// POR QUÉ ES UN MÓDULO PURO. Igual que stripeBackfill.ts/stripeImport.ts: la sugerencia es una regla
// de negocio, no una llamada a red ni a base de datos. El webhook resuelve el contacto, la venta activa
// del contacto, el mapeo de precios y los planes del tenant, y este módulo solo decide qué sugerir con
// esos datos — así se puede probar entero sin Supabase ni Stripe.
//
// LO QUE NUNCA HACE: no crea nada en `sales`/`collections`. Solo devuelve una sugerencia que queda en
// `sale_drafts` a la espera de que un closer/admin la apruebe (o la corrija) — ver
// app/api/[tenant]/evergreen/sales/drafts/[id]/approve/route.ts.
//
// ORDEN DE CONFIANZA DE LA SUGERENCIA (de más a menos fiable):
//   1. Venta activa ya existente del contacto → esto es casi con seguridad una cuota más, y el
//      producto/plan ya los decidió una persona cuando se creó esa venta.
//   2. Price ID de Stripe mapeado en `stripe_price_map` → lo decidió un admin una vez, de antemano.
//   3. Importe que coincide EXACTAMENTE con el precio (o precio/nº de cuotas) de un ÚNICO plan activo
//      del tenant → es una coincidencia razonable, pero la más débil de las tres.
//   Sin ninguna de las tres, o con más de un candidato por importe, no se sugiere nada: el admin elige.

export type PlanLite = {
  id: string
  productId: string
  grossPrice: number
  numberOfPayments: number
}

export type PriceMapLite = {
  stripePriceId: string
  productId: string
  paymentPlanId: string
}

export type ActiveSaleLite = {
  id: string
  productId: string
  paymentPlanId: string
}

export type DraftSuggestion = {
  suggestedProductId: string | null
  suggestedPaymentPlanId: string | null
  existingSaleId: string | null
  reason: string
}

const money = (n: number) => Math.round(n * 100) / 100

export function suggestForDraft(input: {
  amount: number
  stripePriceId: string | null
  /** La venta ACTIVA más reciente del contacto, si tiene alguna. Null si no tiene ninguna. */
  activeSale: ActiveSaleLite | null
  priceMap: PriceMapLite[]
  /** Solo planes activos del tenant. */
  plans: PlanLite[]
}): DraftSuggestion {
  if (input.activeSale) {
    return {
      suggestedProductId: input.activeSale.productId,
      suggestedPaymentPlanId: input.activeSale.paymentPlanId,
      existingSaleId: input.activeSale.id,
      reason: 'El contacto ya tiene una venta activa: lo más probable es que este pago sea una cuota de esa venta.',
    }
  }

  if (input.stripePriceId) {
    const mapeado = input.priceMap.find((m) => m.stripePriceId === input.stripePriceId)
    if (mapeado) {
      return {
        suggestedProductId: mapeado.productId,
        suggestedPaymentPlanId: mapeado.paymentPlanId,
        existingSaleId: null,
        reason: `Reconocido por el Price ID de Stripe (${input.stripePriceId}), mapeado en Integraciones.`,
      }
    }
  }

  const importe = money(input.amount)
  const candidatos = input.plans.filter((p) => {
    if (money(p.grossPrice) === importe) return true
    if (p.numberOfPayments > 0 && money(p.grossPrice / p.numberOfPayments) === importe) return true
    return false
  })

  if (candidatos.length === 1) {
    const p = candidatos[0]
    return {
      suggestedProductId: p.productId,
      suggestedPaymentPlanId: p.id,
      existingSaleId: null,
      reason: `El importe (${importe}) coincide con el único plan activo que cuadra: no hay Price ID mapeado, así que es una coincidencia por precio, no por producto.`,
    }
  }
  if (candidatos.length > 1) {
    return {
      suggestedProductId: null,
      suggestedPaymentPlanId: null,
      existingSaleId: null,
      reason: `El importe coincide con ${candidatos.length} planes activos distintos: no se puede elegir uno sin más información.`,
    }
  }

  return {
    suggestedProductId: null,
    suggestedPaymentPlanId: null,
    existingSaleId: null,
    reason: input.stripePriceId
      ? `El Price ID de Stripe (${input.stripePriceId}) no está mapeado en Integraciones, y el importe no coincide con ningún plan activo.`
      : 'Sin venta previa, sin Price ID en el evento y sin plan cuyo importe coincida: el admin debe elegir producto y plan.',
  }
}

/** Por qué NO crear un borrador para este pago (o si hay que crearlo). */
export type DraftGate = 'crear' | 'ya_registrado' | 'ya_borrador' | 'sin_contacto'

export function gateForDraft(input: {
  contactId: string | null
  paymentReference: string
  /** Referencias ya presentes en `collections.payment_reference` de este tenant. */
  knownCollectionReferences: Set<string>
  /** `payment_reference` ya presentes en `sale_drafts` de este tenant. */
  existingDraftReferences: Set<string>
}): DraftGate {
  if (input.knownCollectionReferences.has(input.paymentReference)) return 'ya_registrado'
  if (input.existingDraftReferences.has(input.paymentReference)) return 'ya_borrador'
  if (!input.contactId) return 'sin_contacto'
  return 'crear'
}
