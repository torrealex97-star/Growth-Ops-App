import { normalizarEventoStripe, type EventoStripeNormalizado } from '@/lib/stripe/webhook'

// F1 — EL MISMO CAMINO PARA STRIPE.
//
// El webhook de Stripe ya guardaba el sobre (fue el primero en hacerlo). Lo que faltaba era el paso
// siguiente: convertirlo en hecho, igual que GHL, para que el reprocesado sirva también aquí.
//
// LA SEMÁNTICA FINANCIERA NO SE TOCA — el plan es explícito (§F1: "sin cambiar la semántica
// financiera"). Esto NO escribe en `collections` ni decide qué cuenta como dinero: eso sigue en
// `lib/stripe/webhook.ts` (`clase`) y en el registro manual desde Ventas. Aquí solo se guarda el
// HECHO de que Stripe dijo algo, con la clasificación que aquel módulo ya hizo.
//
// Por qué importa: de los tres eventos que Stripe emite por un mismo pago, solo uno es dinero. Si
// esta capa los contara todos, el cash saldría por triplicado. Por eso el tipo del hecho conserva la
// clase, y quien lea `canonical_events` sabe cuál cuenta sin tener que reinterpretar nada.

export const NORMALIZADOR_STRIPE = 'stripe-1'

/** Tipo del hecho según la clase que ya decidió el normalizador. */
export function tipoEventoStripe(n: EventoStripeNormalizado): string {
  switch (n.clase) {
    case 'cobro':
      return 'stripe.cobro'
    case 'reembolso':
      return 'stripe.reembolso'
    case 'duplicado_economico':
      return 'stripe.duplicado'
    case 'contexto':
      return 'stripe.contexto'
    default:
      return 'stripe.ignorado'
  }
}

/**
 * Propiedades del hecho: el dinero y sus referencias, nunca la persona.
 *
 * `email` y `stripeCustomerId` se quedan fuera a propósito. El sobre completo los tiene en
 * `raw_events` con su propio control de acceso; duplicarlos aquí multiplicaría los sitios donde hay
 * que ir a borrar cuando alguien ejerce su derecho al olvido (`docs/F6-MAPA-PII.md`).
 */
export function propiedadesStripe(n: EventoStripeNormalizado): Record<string, unknown> {
  const props: Record<string, unknown> = {
    tipo_stripe: n.tipo,
    clase: n.clase,
    // Se conserva el porqué de la clasificación: sin él, un "duplicado" raro no se puede auditar sin
    // volver a razonar el payload entero.
    motivo: n.motivo,
  }
  if (n.referenciaPago) props.referencia_pago = n.referenciaPago
  if (n.referenciasAlternativas.length) props.referencias_alternativas = n.referenciasAlternativas
  if (n.importeEur !== null) props.importe_eur = n.importeEur
  if (n.moneda) props.moneda = n.moneda
  return props
}

/** Lo que el reprocesado y el webhook necesitan de un sobre de Stripe. `null` = no se entiende. */
export function derivarStripe(
  payload: unknown
): { sourceEventId: string; tipo: string; ocurridoEn: string; propiedades: Record<string, unknown> } | null {
  const n = normalizarEventoStripe(payload)
  if ('error' in n) return null
  return {
    sourceEventId: n.eventId,
    tipo: tipoEventoStripe(n),
    ocurridoEn: n.ocurridoEn,
    propiedades: propiedadesStripe(n),
  }
}

export const TIPOS_DE_EVENTO_STRIPE = [
  { nombre: 'stripe.cobro', descripcion: 'Stripe confirma dinero que entra.' },
  { nombre: 'stripe.reembolso', descripcion: 'Stripe confirma dinero que se devuelve.' },
  {
    nombre: 'stripe.duplicado',
    descripcion: 'Evento cierto cuyo dinero ya cuenta por otro evento: NO se suma.',
  },
  { nombre: 'stripe.contexto', descripcion: 'Cambio útil que no mueve dinero (cliente, suscripción).' },
  { nombre: 'stripe.ignorado', descripcion: 'Evento de Stripe guardado sin efecto en el negocio.' },
] as const
