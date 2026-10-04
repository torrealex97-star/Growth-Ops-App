// SALUD DE LOS WEBHOOKS ENTRANTES — la mitad que ESPERA datos.
//
// "Estado de las sincronizaciones" mira la mitad que SALE a buscar (crons y botones de pull). La
// mitad que espera — el webhook al que el proveedor llama — puede llevar días sin recibir nada y
// ninguna tarjeta se entera: los conectores ven su propio pull, no la recepción. Este control mira
// la EVIDENCIA DE RECEPCIÓN REAL de cada webhook (sobres en `raw_events`, o actas en `audit_logs`
// para el que aún no escribe sobre), que es lo único que prueba que la llamada entró: si la
// integración está configurada y no llega nada en 24h, hay un SILENCIO que hay que mirar aunque el
// cron disimule los síntomas trayendo datos viejos.
//
// SILENCIO NO ES ROTURA DEMOSTRADA (auditoría F23). Que no llegue nada en 24 h puede ser que el
// proveedor no haya tenido nada que avisar (un fin de semana sin citas) o que sus envíos fallen. Lo
// primero no es una avería, y esta señal por sí sola no distingue ambas cosas: por eso el mensaje dice
// «comprueba» en vez de «está roto», y la pantalla lo pinta en ámbar, no en rojo. Un fallo CONFIRMADO
// (firma rechazada, error HTTP del proveedor) es otra señal y es la que justifica el rojo.
//
// DOS REGLAS del resto del módulo también gobiernan aquí:
//  · Un hueco no es un cero: si la evidencia no se pudo leer, el estado es `desconocido`, nunca
//    "al día".
//  · Una integración que la subcuenta no usa no es una avería: `sin_configurar` no avisa.

export type EstadoSaludWebhook = 'al_dia' | 'silencio' | 'sin_configurar' | 'desconocido'

export type SaludWebhook = {
  estado: EstadoSaludWebhook
  /** Qué significa y qué mirar. Una frase, sin códigos. */
  mensaje: string
  /** ISO de la última recepción con evidencia real. `null` = ninguna o no se pudo leer. */
  ultimoSobre: string | null
  /** Horas transcurridas desde la última recepción. `null` = no se sabe. */
  horasDesde: number | null
}

/** Webhooks entrantes con control de silencio. La evidencia de cada uno la elige la route. */
export type ProveedorWebhook = 'ghl' | 'calendly' | 'stripe'

/** Silencio de la mitad receptora que ya merece aviso: 24 h sin recepción con la integración viva. */
export const SILENCIO_WEBHOOK_MS = 24 * 60 * 60 * 1000

const ETIQUETA: Record<ProveedorWebhook, string> = { ghl: 'GHL', calendly: 'Calendly', stripe: 'Stripe' }

/** Dónde mirar cuando el webhook lleva el alta y no ha llegado NUNCA nada. */
const ALTA_SIN_RECIBIR: Record<ProveedorWebhook, string> = {
  ghl: 'el alta en GHL o el secret no están funcionando',
  calendly: 'la suscripción en Calendly o la Signing Key no están funcionando',
  stripe: 'el endpoint en Stripe o su firma no están funcionando',
}

/** Dónde mirar cuando la fecha de la última recepción no se puede interpretar. */
const RUTA_REVISION: Record<ProveedorWebhook, string> = {
  ghl: 'revisa la capa de eventos en bruto',
  calendly: 'revisa el historial de auditoría',
  stripe: 'revisa la capa de eventos en bruto',
}

export function saludWebhook(input: {
  proveedor: ProveedorWebhook
  /** La subcuenta usa la integración: credenciales de pull o secret del webhook configurados. */
  configurado: boolean
  /** ISO de la última recepción con evidencia real. `null` = ninguna. */
  ultimoSobre: string | null
  /** `false` = la evidencia no se pudo leer: no se afirma que esté al día. */
  leido?: boolean
  umbralMs?: number
  ahora?: number
}): SaludWebhook {
  const umbral = input.umbralMs ?? SILENCIO_WEBHOOK_MS
  const ahora = input.ahora ?? Date.now()
  const etiqueta = ETIQUETA[input.proveedor]

  if (!input.configurado) {
    return {
      estado: 'sin_configurar',
      mensaje: `Esta subcuenta no tiene ${etiqueta} configurado: el control solo aplica a quien lo usa.`,
      ultimoSobre: null,
      horasDesde: null,
    }
  }
  if (input.leido === false) {
    return {
      estado: 'desconocido',
      mensaje: 'No se pudo leer la evidencia de recepción: no se sabe cuándo entró lo último.',
      ultimoSobre: null,
      horasDesde: null,
    }
  }
  if (!input.ultimoSobre) {
    return {
      estado: 'silencio',
      mensaje: `${etiqueta} está configurado pero el webhook nunca ha recibido un sobre. Comprueba el envío: ${ALTA_SIN_RECIBIR[input.proveedor]}.`,
      ultimoSobre: null,
      horasDesde: null,
    }
  }
  const t = Date.parse(input.ultimoSobre)
  if (Number.isNaN(t)) {
    return {
      estado: 'desconocido',
      mensaje: `La fecha de la última recepción no se puede interpretar: ${RUTA_REVISION[input.proveedor]}.`,
      ultimoSobre: input.ultimoSobre,
      horasDesde: null,
    }
  }
  const horas = (ahora - t) / 3_600_000
  if (ahora - t >= umbral) {
    return {
      estado: 'silencio',
      mensaje: `Sin recepciones de ${etiqueta} desde hace ${Math.round(horas)} h (umbral 24 h). No prueba que esté roto —puede no haber habido actividad—: comprueba en el panel del proveedor si hay envíos fallidos; el cron sigue trayendo datos mientras tanto.`,
      ultimoSobre: input.ultimoSobre,
      horasDesde: horas,
    }
  }
  return {
    estado: 'al_dia',
    mensaje: `Última recepción hace ${Math.round(horas)} h.`,
    ultimoSobre: input.ultimoSobre,
    horasDesde: horas,
  }
}
