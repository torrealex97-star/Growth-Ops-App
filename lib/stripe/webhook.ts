// WEBHOOK DE STRIPE: verificación de firma y semántica económica.
//
// POR QUÉ HACÍA FALTA. Toda la ingesta económica era de tirón (backfill + cron): las ventas solo
// entraban cuando una persona pulsaba el importador. Un cobro de hoy no existía en la app hasta que
// alguien se acordaba. El webhook es la mitad continua que faltaba — el backfill sigue siendo la
// mitad histórica, y son dos cosas distintas que se necesitan las dos.
//
// POR QUÉ ES UN MÓDULO PURO. La firma es criptografía y la semántica económica es aritmética: las dos
// se prueban sin red. Eso importa aquí más que en otros sitios, porque de estas reglas depende que un
// mismo cobro no se cuente dos veces.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL DOBLE CONTEO, que es el problema difícil de Stripe.
//
// Un solo pago de 499€ puede generar TRES eventos:
//
//   invoice.payment_succeeded   (si hay suscripción)
//   payment_intent.succeeded
//   charge.succeeded
//
// Los tres son ciertos y los tres hablan del MISMO dinero. Procesarlos todos convierte 499€ en
// 1.497€ de cash collected, y el número resultante es creíble.
//
// LA REGLA QUE SE APLICA: el PaymentIntent es el evento canónico del dinero.
//
//   · `payment_intent.succeeded`  -> ESTE cuenta. Es el nivel donde Stripe agrupa el intento de cobro
//                                    completo, y es lo que ya usa el backfill como referencia.
//   · `charge.succeeded`          -> se IGNORA cuando trae `payment_intent`, porque ese pago ya vendrá
//                                    (o vino) por el evento del intent. Solo cuenta cuando NO hay
//                                    intent: cargos directos heredados, que existen y no tienen otro
//                                    evento que los represente.
//   · `invoice.payment_succeeded` -> se IGNORA para el dinero por la misma razón: su cobro llega por
//                                    su propio PaymentIntent. Se conserva como contexto (a qué
//                                    suscripción pertenece), no como importe.
//
// Así cada euro entra una sola vez, y la elección está escrita en vez de repartida por el handler.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'

/** Ventana de tolerancia del timestamp, en segundos. Es el valor que recomienda Stripe. */
export const TOLERANCIA_FIRMA_SEGUNDOS = 300

export type ResultadoFirma =
  | { valida: true }
  | { valida: false; motivo: string; codigo: 'sin_secreto' | 'sin_cabecera' | 'formato' | 'caducada' | 'no_coincide' }

/**
 * Verifica la firma `Stripe-Signature`.
 *
 * El esquema de Stripe: la cabecera trae `t=<epoch>,v1=<hmac>`, y el HMAC-SHA256 se calcula sobre
 * `${t}.${cuerpoCrudo}` con el secreto del endpoint.
 *
 * TRES COSAS QUE HAY QUE HACER BIEN, y las tres tienen su test:
 *
 * 1. EL CUERPO TIENE QUE SER EL CRUDO, byte a byte. Si se parsea el JSON y se vuelve a serializar, el
 *    orden de claves o los espacios cambian y la firma deja de cuadrar aunque el mensaje sea legítimo.
 *    De ahí que la ruta lea `await req.text()` y no `req.json()`.
 * 2. COMPARACIÓN EN TIEMPO CONSTANTE. `expected === recibido` filtra por timing cuántos caracteres
 *    iniciales coinciden, y con eso se puede construir una firma válida a base de intentos.
 * 3. PROTECCIÓN DE REPETICIÓN. Sin comprobar el timestamp, una petición legítima capturada sirve para
 *    siempre: quien la tenga puede reenviarla indefinidamente y cada reenvío pasaría la firma.
 *
 * Se admiten VARIAS `v1` en la cabecera: Stripe manda dos durante una rotación de secreto, y
 * quedarse solo con la primera rompe la ingesta justo mientras se rota.
 */
export function verificarFirmaStripe(
  cuerpoCrudo: string,
  cabecera: string | null | undefined,
  secreto: string | undefined,
  opts: { ahoraSegundos?: number; toleranciaSegundos?: number } = {}
): ResultadoFirma {
  if (!secreto) {
    return {
      valida: false,
      codigo: 'sin_secreto',
      motivo: 'No hay secreto de webhook configurado, así que no se puede verificar quién envía esto.',
    }
  }
  if (!cabecera) {
    return { valida: false, codigo: 'sin_cabecera', motivo: 'Falta la cabecera Stripe-Signature.' }
  }

  let t: string | null = null
  const firmas: string[] = []
  for (const parte of cabecera.split(',')) {
    const [clave, valor] = parte.split('=', 2)
    if (!clave || !valor) continue
    if (clave.trim() === 't') t = valor.trim()
    // Varias v1 durante una rotación de secreto: se guardan todas.
    if (clave.trim() === 'v1') firmas.push(valor.trim())
  }

  if (!t || firmas.length === 0) {
    return { valida: false, codigo: 'formato', motivo: 'La cabecera Stripe-Signature no tiene el formato esperado.' }
  }

  const marca = Number(t)
  if (!Number.isFinite(marca)) {
    return { valida: false, codigo: 'formato', motivo: 'El timestamp de la firma no es un número.' }
  }

  const ahora = opts.ahoraSegundos ?? Math.floor(Date.now() / 1000)
  const tolerancia = opts.toleranciaSegundos ?? TOLERANCIA_FIRMA_SEGUNDOS
  // Se comprueba en valor absoluto: una marca muy en el FUTURO también es sospechosa, y además
  // delataría un reloj desajustado en vez de aceptarla en silencio.
  if (Math.abs(ahora - marca) > tolerancia) {
    return {
      valida: false,
      codigo: 'caducada',
      motivo: `La firma está fuera de la ventana de ${tolerancia}s (diferencia de ${Math.abs(ahora - marca)}s).`,
    }
  }

  const esperada = crypto.createHmac('sha256', secreto).update(`${marca}.${cuerpoCrudo}`, 'utf8').digest('hex')
  const bufEsperada = Buffer.from(esperada, 'utf8')

  for (const firma of firmas) {
    const buf = Buffer.from(firma, 'utf8')
    // timingSafeEqual LANZA con longitudes distintas: se comprueba antes, y así el rechazo por
    // longitud tampoco filtra nada por timing.
    if (buf.length === bufEsperada.length && crypto.timingSafeEqual(buf, bufEsperada)) {
      return { valida: true }
    }
  }

  return { valida: false, codigo: 'no_coincide', motivo: 'La firma no coincide con el secreto configurado.' }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NORMALIZACIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Qué representa el evento para el negocio. */
export type ClaseEvento =
  /** Dinero que ha entrado. Cuenta para el cash collected. */
  | 'cobro'
  /** Dinero devuelto. */
  | 'reembolso'
  /** Cierto y relevante, pero su dinero ya entra por otro evento: NO se cuenta. */
  | 'duplicado_economico'
  /** Contexto útil que no mueve dinero (cliente creado, suscripción cancelada). */
  | 'contexto'
  /** Ni se cuenta ni se guarda como contexto. */
  | 'ignorado'

export type EventoStripeNormalizado = {
  /** El id del EVENTO en Stripe (`evt_...`). Es la clave de idempotencia de la ingesta. */
  eventId: string
  tipo: string
  clase: ClaseEvento
  /** Referencia del PAGO, la que se guarda en `collections.payment_reference`. */
  referenciaPago: string | null
  /** Referencias alternativas del mismo dinero, para poder cruzar con lo ya registrado. */
  referenciasAlternativas: string[]
  importeEur: number | null
  moneda: string | null
  email: string | null
  stripeCustomerId: string | null
  ocurridoEn: string
  /** Por qué se ha clasificado así. Va al raw event, para poder auditar una decisión rara. */
  motivo: string
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Céntimos a euros. Stripe siempre manda la unidad mínima. */
const aEuros = (centimos: number | null): number | null => (centimos === null ? null : Math.round(centimos) / 100)

/**
 * Traduce un evento de Stripe a lo que el negocio entiende, decidiendo si su dinero cuenta.
 *
 * NO LANZA con un payload raro: devuelve `clase: 'ignorado'` y el motivo. Un evento que no se entiende
 * tiene que quedar registrado como tal, no tumbar la ingesta de los que vienen detrás.
 */
export function normalizarEventoStripe(evento: unknown): EventoStripeNormalizado | { error: string } {
  const e = obj(evento)
  if (!e) return { error: 'El evento no es un objeto.' }

  const eventId = str(e.id)
  const tipo = str(e.type)
  if (!eventId || !tipo) return { error: 'El evento no trae id o type.' }

  const data = obj(e.data)
  const objeto = data ? obj(data.object) : null
  if (!objeto) return { error: `El evento ${tipo} no trae data.object.` }

  const creado = num(e.created)
  const ocurridoEn = new Date((creado ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
  const base = { eventId, tipo, ocurridoEn, moneda: (str(objeto.currency) ?? 'eur').toUpperCase() }

  switch (tipo) {
    // EL EVENTO CANÓNICO DEL DINERO.
    case 'payment_intent.succeeded': {
      const intentId = str(objeto.id)
      const cargo = obj(objeto.latest_charge) ?? null
      const cargoId = str(objeto.latest_charge) ?? (cargo ? str(cargo.id) : null)
      return {
        ...base,
        clase: 'cobro',
        referenciaPago: intentId,
        // El id del cargo entra como alternativa porque el backfill histórico guardó algunas
        // referencias así: sin esto, el mismo cobro se registraría dos veces.
        referenciasAlternativas: [cargoId].filter((v): v is string => !!v),
        importeEur: aEuros(num(objeto.amount_received) ?? num(objeto.amount)),
        email: str(objeto.receipt_email) ?? (cargo ? str(obj(cargo.billing_details)?.email) : null),
        stripeCustomerId: str(objeto.customer),
        motivo: 'PaymentIntent completado: es el evento canónico del cobro.',
      }
    }

    // MISMO DINERO QUE EL INTENT. Solo cuenta si no hay intent detrás.
    case 'charge.succeeded': {
      const cargoId = str(objeto.id)
      const intentId = str(objeto.payment_intent)
      if (intentId) {
        return {
          ...base,
          clase: 'duplicado_economico',
          referenciaPago: cargoId,
          referenciasAlternativas: [intentId],
          importeEur: aEuros(num(objeto.amount)),
          email: str(obj(objeto.billing_details)?.email),
          stripeCustomerId: str(objeto.customer),
          motivo: 'Cargo con PaymentIntent detrás: su dinero entra por el evento del intent, no aquí.',
        }
      }
      return {
        ...base,
        clase: 'cobro',
        referenciaPago: cargoId,
        referenciasAlternativas: [],
        importeEur: aEuros(num(objeto.amount)),
        email: str(obj(objeto.billing_details)?.email),
        stripeCustomerId: str(objeto.customer),
        motivo: 'Cargo directo sin PaymentIntent: no hay otro evento que represente este cobro.',
      }
    }

    case 'charge.refunded': {
      const devuelto = num(objeto.amount_refunded)
      return {
        ...base,
        clase: 'reembolso',
        referenciaPago: str(objeto.id),
        referenciasAlternativas: [str(objeto.payment_intent)].filter((v): v is string => !!v),
        importeEur: aEuros(devuelto),
        email: str(obj(objeto.billing_details)?.email),
        stripeCustomerId: str(objeto.customer),
        motivo: 'Cargo devuelto: resta del dinero cobrado.',
      }
    }

    // EL COBRO DE UNA FACTURA LLEGA POR SU PROPIO PAYMENTINTENT. Aquí solo el contexto.
    case 'invoice.payment_succeeded': {
      return {
        ...base,
        clase: 'duplicado_economico',
        referenciaPago: str(objeto.id),
        referenciasAlternativas: [str(objeto.payment_intent), str(objeto.charge)].filter((v): v is string => !!v),
        importeEur: aEuros(num(objeto.amount_paid)),
        email: str(objeto.customer_email),
        stripeCustomerId: str(objeto.customer),
        motivo: 'Factura cobrada: el dinero entra por el PaymentIntent de esa factura, no por este evento.',
      }
    }

    case 'invoice.payment_failed':
    case 'customer.subscription.deleted':
    case 'customer.subscription.updated':
    case 'customer.created':
    case 'customer.updated': {
      return {
        ...base,
        clase: 'contexto',
        referenciaPago: null,
        referenciasAlternativas: [],
        importeEur: null,
        email: str(objeto.email) ?? str(objeto.customer_email),
        stripeCustomerId: str(objeto.customer) ?? str(objeto.id),
        motivo: 'No mueve dinero, pero explica el estado del cliente o de su suscripción.',
      }
    }

    default:
      return {
        ...base,
        clase: 'ignorado',
        referenciaPago: null,
        referenciasAlternativas: [],
        importeEur: null,
        email: null,
        stripeCustomerId: null,
        motivo: `Tipo de evento no contemplado (${tipo}). Queda registrado en crudo para poder reprocesarlo si hace falta.`,
      }
  }
}

/** ¿Este evento suma o resta dinero? Lo que decide si toca `collections`. */
export function mueveDinero(n: EventoStripeNormalizado): boolean {
  return n.clase === 'cobro' || n.clase === 'reembolso'
}
