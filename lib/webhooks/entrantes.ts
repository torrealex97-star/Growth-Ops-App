// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOKS ENTRANTES — la mitad receptora de las integraciones
// ─────────────────────────────────────────────────────────────────────────────
// El panel de Integraciones siempre contó la mitad que SALE a buscar datos
// (tokens, comprobaciones, syncs). La mitad que ESPERA datos — los webhooks que
// los proveedores llaman — era invisible: estaba repartida entre la guía de GHL,
// el help de Stripe y comentarios de código. Este módulo la hace de primera
// clase: URL exacta por subcuenta, estado del secret y fecha del último evento
// recibido CON SU EVIDENCIA (no una fecha inventada ni "nada").
//
// REGLA DE EVIDENCIA: `ultimo_evento` solo puede salir de un registro real de
// recepción. Nunca se deriva de "hay filas en la tabla" — el pull del cron y el
// botón escriben en las mismas tablas que el webhook, y presentarlas como
// recepción del webhook sería la mentira exacta que este bloque existe para
// desterrar (fue la evidencia forense que demostró que el webhook de GHL nunca
// entró en producción: audit_logs con 1 acta de prueba humana, citas 100% con
// forma de cron).

export type WebhookEntrante = {
  id: string
  /** Proveedor tal y como se llama en Integraciones (enlaza la tarjeta con su fila). */
  groupId: string
  titulo: string
  descripcion: string
  /** Ruta con `{tenant}`; la pantalla la resuelve con el slug de la subcuenta. */
  path: string
  /** Método HTTP del evento, tal y como hay que configurarlo en el proveedor. */
  metodo: 'POST'
  /** Cabecera (o firma) que espera el webhook, para el campo del alta en el proveedor. */
  auth: { tipo: 'cabecera' | 'firma'; nombre: string; configKey: string }
  /** Qué hace el webhook, en una frase por evento. */
  eventos: string[]
  /**
   * Dónde queda constancia de una recepción REAL. null = este webhook aún no escribe la suya
   * (contratos): `ultimo_evento` quedará null — no se sustituye por "hay contratos firmados",
   * que sería derivar recepción de resultado.
   */
  evidencia: 'audit_ghl' | 'audit_calendly' | 'audit_onboarding' | 'raw_stripe' | null
  /**
   * Aviso persistente cuando aplica. No es un error: es una limitación de la plataforma
   * que de otro modo nadie recordaría al configurar.
   */
  aviso?: string
  /** Documentación del alta (limitaciones conocidas incluidas). */
  doc?: string
}

export const WEBHOOKS_ENTRANTES: WebhookEntrante[] = [
  {
    id: 'ghl-citas',
    groupId: 'ghl',
    titulo: 'GoHighLevel — citas y leads',
    descripcion: 'Altas de leads, citas creadas y cambios de estado (show, no show, cancelada) en tiempo real.',
    path: '/api/{tenant}/evergreen/webhooks/ghl',
    metodo: 'POST',
    auth: { tipo: 'cabecera', nombre: 'x-ghl-secret', configKey: 'GHL_WEBHOOK_SECRET' },
    eventos: ['Lead (opt-in)', 'Cita creada', 'Cita actualizada (show / no show / cancelada)'],
    evidencia: 'audit_ghl',
    doc: '/docs/webhooks-ghl.md',
    // Limitación documentada (docs/webhooks-ghl.md): la herramienta simple de webhooks de GHL
    // (Settings › Integrations › Webhooks) no admite cabeceras personalizadas — solo la acción
    // Custom Webhook de workflows. Un alta en el sitio equivocado llega sin secret y todo falla
    // con 401, sin que GHL lo explique.
    aviso:
      'GHL solo puede enviar la cabecera desde un Workflow con acción «Custom Webhook» (LC Premium): su herramienta simple de webhooks no admite cabeceras personalizadas.',
  },
  {
    id: 'calendly',
    groupId: 'calendly',
    titulo: 'Calendly — citas y cancelaciones',
    descripcion: 'Reservas, cancelaciones y reprogramaciones con su formulario de cualificación.',
    path: '/api/{tenant}/evergreen/webhooks/calendly',
    metodo: 'POST',
    auth: { tipo: 'firma', nombre: 'calendly-webhook-signature', configKey: 'CALENDLY_WEBHOOK_SECRET' },
    eventos: ['invitee.created', 'invitee.canceled'],
    evidencia: 'audit_calendly',
    aviso:
      'La Signing Key se lee del entorno del servidor (CALENDLY_WEBHOOK_SECRET en Vercel): si la cambias aquí no se aplica hasta actualizarla en Vercel.',
  },
  {
    id: 'stripe',
    groupId: 'stripe',
    titulo: 'Stripe — pagos',
    descripcion: 'Cobros, devoluciones y cambios de suscripción en el momento, sin esperar al backfill.',
    path: '/api/{tenant}/evergreen/webhooks/stripe',
    metodo: 'POST',
    auth: { tipo: 'firma', nombre: 'stripe-signature', configKey: 'STRIPE_WEBHOOK_SECRET' },
    eventos: ['payment_intent.succeeded', 'charge.refunded', 'pagos y suscripciones'],
    // Evidencia de primera: el webhook de Stripe escribe TODO en raw_events, incluidos los
    // intentos con firma rechazada (rejected). El estado distingue ambos: "recibido" es la
    // última entrega válida, y el rechazo más reciente avisa de una firma que no cuadra.
    evidencia: 'raw_stripe',
  },
  {
    id: 'contratos',
    groupId: 'ghl',
    titulo: 'Firma de contratos (e-sign)',
    descripcion: 'Avisa cuando un contrato se firma: lo marca como firmado y guarda el PDF y la IP.',
    path: '/api/{tenant}/evergreen/webhooks/contract',
    metodo: 'POST',
    // Reutiliza GHL_WEBHOOK_SECRET (comentario de la ruta: "Auth: cabecera x-ghl-secret
    // (reutiliza GHL_WEBHOOK_SECRET)") — mismo valor, mismo transporte que GHL.
    auth: { tipo: 'cabecera', nombre: 'x-ghl-secret', configKey: 'GHL_WEBHOOK_SECRET' },
    eventos: ['Contrato firmado'],
    evidencia: null,
  },
  {
    id: 'onboarding',
    groupId: 'ghl',
    titulo: 'Onboarding del alumno (GHL)',
    descripcion: 'Marca accesos abiertos, sesión agendada y onboarding completado en el pipeline de alumnos.',
    path: '/api/{tenant}/evergreen/webhooks/onboarding',
    metodo: 'POST',
    auth: { tipo: 'cabecera', nombre: 'x-ghl-secret', configKey: 'ONBOARDING_INBOUND_SECRET' },
    eventos: ['click (accesos)', 'booked (sesión agendada)', 'completed (onboarding realizado)'],
    evidencia: 'audit_onboarding',
    aviso: 'Secreto global (ONBOARDING_INBOUND_SECRET en el entorno), no por subcuenta: es el mismo valor para todas.',
  },
]

// ── Evaluación de estado (funciones puras: las fechas vienen de arriba) ──────

export type EstadoSecret = 'ok' | 'sin_configurar' | 'solo_entorno' | 'no_descifrable'

export type UltimoEvento = {
  fecha: string
  /** Nota de la evidencia, p.ej. "acta en el historial de auditoría". */
  evidencia: string
} | null

export type EstadoSecretInfo = {
  estado: EstadoSecret
  /** Longitud en claro. Una longitud no es una credencial: es lo que delata un pegado a medias. */
  longitud: number | null
  /** Dónde vive el valor que se usa de verdad: panel (cifrado), entorno o ninguno. */
  fuente: 'panel' | 'entorno' | 'ninguno'
  pista: string
}

/** Fila mínima del estado de claves que el GET de Integraciones ya calcula. */
export type EntradaClave = {
  source: 'db' | 'env' | 'none'
  length?: number
}

/** Lo que la API entrega al panel por cada webhook entrante: catálogo + estado vivo. */
export type WebhookEntranteEstado = {
  id: string
  groupId: string
  titulo: string
  descripcion: string
  path: string
  metodo: 'POST'
  auth: WebhookEntrante['auth']
  eventos: string[]
  aviso: string | null
  doc: string | null
  secret: EstadoSecretInfo
  /** Última recepción con evidencia real; null = nunca ha llegado ninguna (NO "0"). */
  ultimoEvento: UltimoEvento
  /** Solo Stripe: la entrega con firma rechazada más reciente, si la hay. */
  ultimoRechazo: UltimoEvento
}

/**
 * Estado del secreto esperado a partir de lo que el panel ya sabe.
 *
 * PRECEDENCIA (la que usan las rutas de verdad): el valor del panel GANA sobre el entorno
 * (`cfg.GHL_WEBHOOK_SECRET || process.env.GHL_WEBHOOK_SECRET` en el webhook de GHL). Antes se
 * pintaba "configurado" cuando solo existía en el entorno — y el panel escondía que el valor
 * vivo era otro.
 */
export function evaluarSecret(cfg: EntradaClave | undefined): EstadoSecretInfo {
  const fuente = cfg?.source ?? 'none'
  const longitud = typeof cfg?.length === 'number' ? cfg.length : null
  if (fuente === 'db') {
    // El GET devuelve los secretos con `length` (longitud en claro); si no llegó, no se inventa.
    if (longitud == null) {
      return {
        estado: 'no_descifrable',
        longitud: null,
        fuente: 'panel',
        pista: 'El valor está guardado pero no se pudo descifrar (p. ej. CONFIG_ENC_KEY cambiada): regrábalo.',
      }
    }
    return {
      estado: 'ok',
      longitud,
      fuente: 'panel',
      pista: `Guardado en el panel: ${longitud} caracteres. Debe ser idéntico al que envía el proveedor, byte a byte.`,
    }
  }
  if (fuente === 'env') {
    return {
      estado: 'solo_entorno',
      longitud,
      fuente: 'entorno',
      pista:
        'Vive solo en las variables de entorno del servidor (Vercel): el webhook usará ese valor aunque guardes otro aquí. Grábalo en el panel para que el panel y el webhook digan lo mismo.',
    }
  }
  return {
    estado: 'sin_configurar',
    longitud: null,
    fuente: 'ninguno',
    pista: 'Sin valor en el panel ni en el entorno: los eventos entrantes serán rechazados con 401.',
  }
}

/** Fila mínima de audit_logs para la evidencia. */
export type ActaAudit = {
  entity_type: string
  action: string
  created_at: string
  new_values: Record<string, unknown> | null
}

/** Última recepción de un webhook con constancia en audit_logs (GHL, Calendly, onboarding). */
export function ultimoEventoEnAudit(evidencia: WebhookEntrante['evidencia'], actas: ActaAudit[]): UltimoEvento {
  const marcadoresWebhook = ['ghl_webhook', 'ghl_onboarding_click', 'ghl_onboarding_booked', 'ghl_onboarding_completed']
  const esRecepcion = (acta: ActaAudit): boolean => {
    const via = acta.new_values?.via
    const viaEsMarcador = typeof via === 'string' && marcadoresWebhook.includes(via)
    switch (evidencia) {
      case 'audit_ghl':
        // El webhook de GHL y el cron/botón escriben en appointments: sin el marcador via, el
        // pull diario contaminaría este estado con fechas que no son suyas.
        return via === 'ghl_webhook'
      case 'audit_onboarding':
        return viaEsMarcador
      case 'audit_calendly':
        // Acciones que nacen SOLO del webhook de Calendly (el pull de Calendly no escribe actas;
        // reprogramaciones solo entran por webhook). El webhook de Calendly no marca via: la
        // combinación entity_type+action es su huella — PERO las actas de los webhooks de GHL
        // usan esas mismas acciones (create/update con via ghl_webhook), así que se excluyen
        // explícitamente. La reprogramación manual escribe action='reschedule' (distinta de
        // reschedule_in/out): tampoco es de Calendly.
        return (
          acta.entity_type === 'appointment' &&
          ['create', 'update', 'cancel', 'reschedule_in', 'reschedule_out'].includes(acta.action) &&
          !(typeof via === 'string' && via.startsWith('ghl_'))
        )
      default:
        return false
    }
  }
  const ultima = actas.filter(esRecepcion).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
  if (!ultima) return null
  const nota =
    evidencia === 'audit_calendly'
      ? 'acta en el historial de auditoría'
      : evidencia === 'audit_onboarding'
        ? 'acta en el historial de auditoría (via ghl_onboarding_*)'
        : 'acta en el historial de auditoría (via ghl_webhook)'
  return { fecha: ultima.created_at, evidencia: nota }
}

/** Fila mínima de raw_events para la evidencia de Stripe. */
export type RawStripe = { received_at: string; processing_status: string }

/**
 * Última entrega válida de Stripe y el rechazo de firma más reciente. Stripe escribe TODO en
 * raw_events — incluidos los intentos con firma rechazada — así que aquí se separan: "recibido"
 * es la última entrega válida, y `ultimo_rechazo` avisa de una firma que no cuadra.
 */
export function eventosStripe(rows: RawStripe[]): { ultimo_valido: UltimoEvento; ultimo_rechazo: UltimoEvento } {
  const porFecha = (a: RawStripe, b: RawStripe) => Date.parse(b.received_at) - Date.parse(a.received_at)
  const valido = rows.filter((r) => r.processing_status !== 'rejected').sort(porFecha)[0]
  const rechazo = rows.filter((r) => r.processing_status === 'rejected').sort(porFecha)[0]
  return {
    ultimo_valido: valido
      ? { fecha: valido.received_at, evidencia: 'registro en la capa de eventos crudos (raw_events)' }
      : null,
    ultimo_rechazo: rechazo
      ? { fecha: rechazo.received_at, evidencia: 'entrega con firma rechazada en raw_events' }
      : null,
  }
}
