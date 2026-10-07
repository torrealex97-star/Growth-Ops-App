import { isValidWebhookSecret, type VeredictoFirma } from './verifySecret'

// FIRMA DEL WEBHOOK DE HOTMART.
//
// Hotmart valida sus entregas 2.0 con el Hottok único de la cuenta, enviado en la cabecera
// `X-HOTMART-HOTTOK`. Es el único mecanismo documentado oficialmente por Hotmart. No aceptamos
// cabeceras HMAC inventadas o de intermediarios: enseñar un método no soportado en el panel haría
// que una integración correctamente configurada fallara en producción.
//
// FAIL-CLOSED: sin secreto guardado para la subcuenta, nada pasa. La respuesta al proveedor es
// siempre opaca (401); el motivo concreto es solo para el log del servidor — nunca contiene el
// valor del secreto.

export function verificarFirmaHotmart(_raw: string, cabeceras: Headers, secreto: string | undefined): VeredictoFirma {
  if (!secreto) {
    return {
      valida: false,
      motivo: 'no hay HOTMART_WEBHOOK_SECRET guardado para esta subcuenta (Configuración → Integraciones → Hotmart)',
    }
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
    motivo: 'la petición no trae X-HOTMART-HOTTOK',
  }
}
