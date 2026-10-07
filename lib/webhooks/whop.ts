import crypto from 'crypto'
import type { VeredictoFirma } from './verifySecret'

// FIRMA DEL WEBHOOK DE WHOP — especificación Standard Webhooks.
//
// Whop firma `{webhook-id}.{webhook-timestamp}.{cuerpo crudo}` con HMAC-SHA256 usando la clave
// `ws_...` del webhook, y manda el resultado en base64 en la cabecera `webhook-signature` con
// esquema `v1,`. La especificación es pública (standardwebhooks.com) y la doc de Whop la repite
// textualmente (docs.whop.com/developer/guides/webhooks), incluida la regla anti-replay: rechazar
// entregas cuyo `webhook-timestamp` diste más de 5 minutos del presente.
//
// FAIL-CLOSED: sin secreto guardado para la subcuenta, nada pasa. La respuesta al proveedor es
// siempre opaca (401); el motivo concreto es solo para el log del servidor — nunca contiene el
// valor del secreto.

export const TOLERANCIA_REPLAY_SEGUNDOS = 300

export function verificarFirmaWhop(raw: string, cabeceras: Headers, secreto: string | undefined): VeredictoFirma {
  if (!secreto) {
    return {
      valida: false,
      motivo: 'no hay WHOP_WEBHOOK_SECRET guardado para esta subcuenta (Configuración → Integraciones → Whop)',
    }
  }

  const id = cabeceras.get('webhook-id')
  const timestamp = cabeceras.get('webhook-timestamp')
  const firma = cabeceras.get('webhook-signature')
  if (!id || !timestamp || !firma) {
    const faltan = [!id && 'webhook-id', !timestamp && 'webhook-timestamp', !firma && 'webhook-signature'].filter(
      Boolean
    )
    return { valida: false, motivo: `faltan las cabeceras ${faltan.join(', ')} de Standard Webhooks` }
  }

  const segundos = Number(timestamp)
  if (!Number.isFinite(segundos)) {
    return { valida: false, motivo: 'webhook-timestamp no es un número de segundos válido' }
  }
  const desvio = Math.abs(Date.now() / 1000 - segundos)
  if (desvio > TOLERANCIA_REPLAY_SEGUNDOS) {
    // La ventana anti-replay de la especificación: una entrega válida reenviada minutos después
    // se rechaza, que es lo que impide capturar y reproducir una entrega legítima.
    return { valida: false, motivo: `webhook-timestamp fuera de la ventana anti-replay (${Math.round(desvio)} s)` }
  }

  // `webhook-signature` puede traer varias firmas separadas por espacio (la especificación lo
  // permite para rotación de claves): vale con que UNA sea válida.
  for (const entrada of firma.split(' ')) {
    const [esquema, mac] = entrada.split(',')
    if (esquema !== 'v1' || !mac) continue
    const esperada = crypto.createHmac('sha256', secreto).update(`${id}.${timestamp}.${raw}`).digest('base64')
    const recibida = Buffer.from(mac)
    const candidata = Buffer.from(esperada)
    if (recibida.length === candidata.length && crypto.timingSafeEqual(recibida, candidata)) {
      return { valida: true, motivo: null }
    }
  }
  return { valida: false, motivo: 'ninguna firma v1 coincide con la clave guardada' }
}
