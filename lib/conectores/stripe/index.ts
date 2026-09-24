import { syncStripePayments } from '@/lib/finance/stripePaymentsSync'
import { derivarStripe } from '@/lib/eventos/stripe'
import { stripeGet } from '@/lib/stripe/client'
import { normalizarEventoStripe, verificarFirmaStripe } from '@/lib/stripe/webhook'

import type {
  Conector,
  ConnectorManifest,
  ContextoConector,
  EventoNormalizado,
  ResultadoSalud,
  ResultadoSync,
} from '../contrato'

// F2 — STRIPE SOBRE EL CONTRATO.
//
// ESTO NO REESCRIBE STRIPE. Envuelve lo que ya está en producción y probado:
//   · `lib/stripe/webhook.ts` — la semántica económica (qué evento es dinero y cuál es duplicado)
//     y la verificación de firma. De esas reglas depende que un cobro no cuente dos veces.
//   · `lib/finance/stripePaymentsSync.ts` — la mitad PULL (espejo `stripe_payments`, fuente
//     primaria del cash canónico), con su paginación por presupuesto.
//   · `lib/eventos/stripe.ts` — la derivación del sobre a hecho canónico de F1.
//   · `lib/stripe/client.ts` — autenticación, timeout y errores traducidos.
//
// LO QUE APORTA EL ENVOLTORIO: el manifiesto, para que el panel diga la verdad sobre Stripe sin
// leer cuatro ficheros, y la suite de contrato lo mantenga sincronizado con la implementación.
//
// EL LÍMITE QUE ESTE CONECTOR NO CRUZA: aquí no se decide qué es dinero del negocio. El webhook
// guarda el sobre y deriva el HECHO, pero `collections` y `sales` nacen de una decisión humana
// (registrar una venta exige producto y plan que el mensaje de un tercero no trae). El test de
// arquitectura "ningún webhook CREA facturación" lo fija; este conector lo respeta.

export const manifest: ConnectorManifest = {
  provider: 'stripe',
  version: '1.0',
  label: 'Stripe',
  // Dos credenciales de naturaleza distinta: la Secret Key para leer su API y el signing secret
  // para verificar lo que él nos empuja. El modo declara la principal; `requiredKeys` las nombra.
  authMode: 'api_key',
  requiredKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  // El catálogo de Integraciones solo exige la Secret Key: sin webhook se pierde el tiempo real,
  // pero el backfill y la conciliación siguen funcionando. Aquí se declaran las DOS porque el
  // conector expone las dos mitades; qué falta en cada subcuenta lo dice la salud.
  supportedObjects: ['payments'],
  // `webhook` y `backfill`/`manual` son las dos mitades reales (push y pull). NO declara
  // 'incremental': el pull relee los PaymentIntents recientes y refresca por upsert, porque la
  // devolución de un pago puede llegar entre ejecuciones y un cursor "ya traído" la congelaría.
  syncModes: ['webhook', 'backfill', 'manual'],
  capabilities: {
    ingestWebhook: true,
    backfill: true,
    healthCheck: true,
    // `executeAction` NO: esta app LEE de Stripe. Escribir hacia fuera (crear cobros, cambiar
    // suscripciones) sería tocar el dinero de un cliente; declararlo "por si acaso" anunciaría un
    // permiso que nadie ha revisado.
  },
  // La misma ruta del catálogo y del webhook real: `/api/{tenant}/…` (el segmento literal
  // `evergreen` se conserva tal cual en producción, ver ACTIVE_HANDOFF › identidad).
  webhookPath: '/api/{tenant}/evergreen/webhooks/stripe',
  // ~100 lecturas/seg en vivo y ~100 en modo test son el techo oficial de la API de Stripe; el
  // cliente ya pagina con presupuesto y el 429 traduce a `limite_de_uso`.
  rateLimitPorMinuto: 100,
}

/**
 * PURO. Es la MISMA derivación que usa el webhook y el reprocesado (F1): una sola interpretación
 * del evento, no una copia que acabaría divergiendo. `derivarStripe` devuelve `null` cuando no
 * entiende el payload — nunca inventa un evento.
 */
export function normalize(crudo: unknown): EventoNormalizado | null {
  return derivarStripe(crudo)
}

export const conector: Conector = {
  manifest,
  normalize,

  /**
   * Interpreta el cuerpo crudo del webhook SIN verificar firma y SIN escribir. La verificación de
   * firma es responsabilidad de la RUTA (necesita el cuerpo byte a byte, y es quien rechaza), y el
   * guardado del sobre también (F1). Aquí solo se promete lo que el contrato dice: entender el
   * payload o devolver null.
   */
  ingestWebhook(crudo): EventoNormalizado | null {
    return normalize(crudo)
  },

  /**
   * Comprueba credenciales SIN escribir nada: una petición barata y de solo lectura
   * (`GET /v1/balance` no toca datos de negocio) con el mismo cliente que usa todo lo demás.
   */
  async healthCheck(ctx): Promise<ResultadoSalud> {
    const key = ctx.cfg.STRIPE_SECRET_KEY?.trim()
    if (!key) {
      return {
        ok: false,
        mensaje: 'Falta la Secret Key de Stripe en esta subcuenta.',
        codigo: 'sin_credenciales',
      }
    }
    try {
      const balance = await stripeGet<{ object?: string; available?: { amount?: number }[] }>(
        'balance',
        new URLSearchParams(),
        { secretKey: key, accountId: ctx.cfg.STRIPE_ACCOUNT_ID || undefined }
      )
      if (balance.object === 'balance') {
        return { ok: true, mensaje: 'Clave de Stripe válida: lee cobros de esta cuenta.' }
      }
      return {
        ok: false,
        mensaje: 'Stripe respondió algo inesperado al comprobar la clave.',
        codigo: 'respuesta_inesperada',
      }
    } catch (e) {
      const codigo = (e as { code?: string }).code ?? 'error'
      // Códigos estables del cliente de Stripe, los mismos que ya entiende el panel.
      return { ok: false, mensaje: e instanceof Error ? e.message : 'Stripe no respondió.', codigo }
    }
  },

  /**
   * La mitad PULL: sincroniza el espejo `stripe_payments` con la implementación de producción.
   * Requiere client de servicio (el sync es una operación del sistema) y preserva el presupuesto:
   * si no cabe todo, `truncated` sube y la siguiente pasada continúa (el upsert es idempotente).
   */
  async backfill(ctx: ContextoConector): Promise<ResultadoSync> {
    const key = ctx.cfg.STRIPE_SECRET_KEY?.trim()
    if (!key) {
      return { escritos: 0, truncado: false, cursor: null, incidencias: ['sin_credenciales: falta STRIPE_SECRET_KEY'] }
    }
    const resultado = await syncStripePayments(ctx.sb, ctx.tenantId, key, ctx.cfg.STRIPE_ACCOUNT_ID || undefined, {
      deadline: ctx.deadline,
    })
    return {
      escritos: resultado.written,
      truncado: resultado.truncated,
      // Sin cursor a propósito (ver el manifiesto): la devolución puede llegar entre pasadas y el
      // upsert la refresca. Un cursor congelaría el estado del pago en el día de la primera lectura.
      cursor: null,
      incidencias: resultado.truncated
        ? ['truncado: Stripe tenía más pagos por leer de los que cabían en el presupuesto; relanzar para continuar']
        : [],
    }
  },
}

// NOTA sobre el cursor: Stripe sí pagina con `starting_after`, pero NO se expone como
// `incrementalSync`: el espejo debe reflejar DEVOLUCIONES posteriores a la primera lectura, y un
// cursor "ya traído hasta aquí" las congelaría. Si algún día se añade, hay que declarar
// `capabilities.incrementalSync` en el mismo commit (la suite de contrato lo exige).
