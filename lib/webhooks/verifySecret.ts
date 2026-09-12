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
