import crypto from 'crypto'

// Comparación segura de secretos de webhook (header/query estático, no HMAC) — evita el timing
// side-channel de `secret === expected`, que revela por cuánto tiempo tarda la comparación
// cuántos caracteres iniciales coinciden. Antes usado en webhooks/{ghl,contract,onboarding}.
// (webhooks/calendly ya usa HMAC + crypto.timingSafeEqual correctamente; este helper generaliza
// ese mismo patrón para los webhooks que comparan un secreto plano en vez de una firma HMAC.)
export function isValidWebhookSecret(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Buffers de distinta longitud: timingSafeEqual lanza en vez de comparar — comparamos primero
  // contra un buffer del mismo tamaño que `expected` para que el rechazo por longitud no filtre
  // nada por timing tampoco (siempre se ejecuta timingSafeEqual con buffers del mismo tamaño).
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Huella de verificación de transporte: sha256 truncado a 8 hex del valor. Permite comparar lo que
 * GHL envía con lo que el panel guarda SIN exponer el valor (un sha256 no se revierte, y 8 hex solo
 * limita las colisiones de pantalla). Si la huella de lo recibido == la del panel, el transporte
 * llegó intacto, byte a byte.
 */
export function huellaSecret(valor: string | null | undefined): string | null {
  if (!valor) return null
  return crypto.createHash('sha256').update(valor, 'utf8').digest('hex').slice(0, 8)
}

export type DiagnosticoCabeceras = {
  cabecera_presente: boolean
  /** Nombre(s) con los que la cabecera llegó al servidor, tal como los vio el runtime. */
  cabecera_nombre_recibida: string[]
  longitud_recibida: number | null
  huella_recibida: string | null
  /** Comparación server-side contra el valor configurado en el panel (sin exponerlo). */
  coincide_con_panel: boolean | null
  panel_configurado: boolean
  /** Pista concreta cuando NO coincide: espacios extra, longitud distinta, valor distinto... */
  pista: string | null
}

/**
 * Diagnóstico del transporte de la cabecera `x-ghl-secret`. Responde a "¿lo que GHL envía llega
 * intacto al endpoint?" con datos medibles (presencia, nombre, longitud, huella y veredicto
 * server-side), jamás con el valor. Motivado por las limitaciones de GHL: su herramienta simple de
 * webhooks (Settings › Integrations › Webhooks) NO admite cabeceras personalizadas — solo la acción
 * "Custom Webhook" de workflows las envía — y cuando la cabecera no llega, el webhook falla con 401
 * sin que GHL explique por qué.
 */
export function diagnosticoCabeceras(headers: Headers, valorPanel: string | undefined): DiagnosticoCabeceras {
  const recibido = headers.get('x-ghl-secret') // .get es case-insensitive por spec HTTP
  const nombres = [...headers.keys()].filter((k) => k.toLowerCase() === 'x-ghl-secret')
  let pista: string | null = null
  let coincide: boolean | null = null
  if (!valorPanel) {
    pista = 'el panel de Integraciones no tiene GHL_WEBHOOK_SECRET configurado'
  } else if (!recibido) {
    pista =
      'la cabecera NO llegó: si el alta usa la herramienta simple de webhooks de GHL, no puede enviar cabeceras — migrar a workflow con acción Custom Webhook'
  } else if (recibido === valorPanel) {
    coincide = true
  } else if (recibido.trim() === valorPanel) {
    coincide = true
    pista = 'coincide tras recortar espacios en blanco: GHL o el copiado añadió espacios'
  } else {
    coincide = false
    pista =
      recibido.length !== valorPanel.length
        ? `longitud distinta (recibido ${recibido.length} vs panel ${valorPanel.length}): valor incompleto o truncado en el alta`
        : 'misma longitud pero valor distinto: el secret pegado en GHL no es el del panel'
  }
  return {
    cabecera_presente: recibido !== null,
    cabecera_nombre_recibida: nombres,
    longitud_recibida: recibido?.length ?? null,
    huella_recibida: huellaSecret(recibido),
    coincide_con_panel: coincide,
    panel_configurado: Boolean(valorPanel),
    pista,
  }
}
