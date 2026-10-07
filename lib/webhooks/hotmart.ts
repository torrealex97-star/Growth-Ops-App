import crypto from 'crypto'
import { isValidWebhookSecret, type VeredictoFirma } from './verifySecret'

// FIRMA DEL WEBHOOK DE HOTMART.
//
// Hotmart valida sus entregas con el token que se define al registrar el webhook. Existen DOS
// mecanismos, según la versión de la entrega, y no siempre queda claro cuál usa cada cuenta:
//
//   1. `X-Hotmart-Hmac`: HMAC-SHA256 del CUERPO CRUDO firmado con ese token. La doc oficial
//      (developers.hotmart.com) está tras CloudFront y no siempre es accesible, y en la naturaleza
//      se ven las dos codificaciones del digest — base64 y hex. Se aceptan ambas: son dos
//      representaciones del mismo HMAC, no dos mecanismos de autenticación.
//   2. `x-hotmart-hottok`: el token en claro como cabecera (postback legacy). Misma prueba de
//      posesión del secreto, sin firma del cuerpo.
//
// FAIL-CLOSED: sin secreto guardado para la subcuenta, nada pasa. La respuesta al proveedor es
// siempre opaca (401); el motivo concreto es solo para el log del servidor — nunca contiene el
// valor del secreto.

export function verificarFirmaHotmart(raw: string, cabeceras: Headers, secreto: string | undefined): VeredictoFirma {
  if (!secreto) {
    return {
      valida: false,
      motivo: 'no hay HOTMART_WEBHOOK_SECRET guardado para esta subcuenta (Configuración → Integraciones → Hotmart)',
    }
  }

  const mac = crypto.createHmac('sha256', secreto).update(raw).digest()
  const hmacRecibido = cabeceras.get('x-hotmart-hmac')
  if (hmacRecibido) {
    const recibida = hmacRecibido.trim()
    // La longitud decide el formato (hex son 64 caracteres, base64 44): comparar contra el
    // candidato del mismo tamaño evita dar por hecho una codificación que el proveedor decidió
    // cambiar sin aviso. Comparación en tiempo constante dentro del formato.
    const candidato = Buffer.from(
      recibida.length === mac.toString('hex').length ? mac.toString('hex') : mac.toString('base64')
    )
    const esperada = Buffer.from(recibida)
    const valida = esperada.length === candidato.length && crypto.timingSafeEqual(esperada, candidato)
    if (!valida) {
      return { valida: false, motivo: 'la firma X-Hotmart-Hmac no coincide con el token guardado' }
    }
    return { valida: true, motivo: null }
  }

  const hotTok = cabeceras.get('x-hotmart-hottok')
  if (hotTok) {
    if (!isValidWebhookSecret(hotTok, secreto)) {
      return { valida: false, motivo: 'el token x-hotmart-hottok no coincide con el guardado' }
    }
    return { valida: true, motivo: null }
  }

  return {
    valida: false,
    motivo: 'la petición no trae ni X-Hotmart-Hmac ni x-hotmart-hottok: el webhook no fue registrado con token',
  }
}
