// Firma y verificación del parámetro `state` de OAuth con Google.
//
// POR QUÉ ESTO EXISTE Y NO ES OPCIONAL. El redirect URI registrado en Google es
// /api/oauth/google/callback, SIN la subcuenta en la ruta (Google exige URIs exactas y registrarlas
// una a una, así que no hay un callback por subcuenta). Eso obliga a que el callback averigüe a qué
// subcuenta pertenece el código que le llega, y el único sitio donde ponerlo es `state`.
//
// Si `state` fuera texto plano, cualquiera podría llamar al callback con `state={"tenant":"otra"}` y
// un código propio, y el refresh token de SU cuenta de Google quedaría guardado como la conexión de
// la subcuenta ajena — o, al revés, redirigir el flujo de un admin a otra subcuenta. Por eso va
// firmado con HMAC y se verifica en tiempo constante.
//
// Además lleva caducidad: un `state` capturado de un enlace viejo no debe servir para siempre.
import crypto from 'crypto'

export type OAuthStatePayload = {
  /** Slug de la subcuenta que inició el flujo. */
  tenant: string
  /** Para qué se pide el permiso. Un flujo de GA4 no debe poder guardarse como conexión de Gmail. */
  provider: 'ga4' | 'gmail'
  /** Marca de tiempo de emisión (ms). */
  iat: number
  /** Aleatorio, para que dos flujos idénticos no produzcan el mismo state. */
  nonce: string
}

/** Ventana en la que un `state` es válido. Un flujo de OAuth se completa en segundos, no en horas. */
export const STATE_TTL_MS = 10 * 60 * 1000

const b64url = (b: Buffer) => b.toString('base64url')

/**
 * Clave de firma derivada de CONFIG_ENC_KEY con una etiqueta propia.
 *
 * Se deriva en vez de usar CONFIG_ENC_KEY tal cual para no reutilizar el mismo material como clave
 * de cifrado y de firma, que es una mala práctica conocida. Y se deriva de una variable que ya es
 * obligatoria en vez de añadir otra: una variable de entorno más es otra cosa que se olvida de
 * configurar al crear un entorno, y aquí eso significaría OAuth roto sin saber por qué.
 */
function signingKey(): Buffer {
  const master = process.env.CONFIG_ENC_KEY
  if (!master) throw new Error('CONFIG_ENC_KEY no configurada (no se puede firmar el state de OAuth)')
  return crypto.createHmac('sha256', master).update('oauth-state-v1').digest()
}

export function signState(input: Omit<OAuthStatePayload, 'iat' | 'nonce'>): string {
  const payload: OAuthStatePayload = {
    ...input,
    iat: Date.now(),
    nonce: crypto.randomBytes(9).toString('base64url'),
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const mac = b64url(crypto.createHmac('sha256', signingKey()).update(body).digest())
  return `${body}.${mac}`
}

export type VerifyResult =
  { ok: true; payload: OAuthStatePayload } | { ok: false; reason: 'formato' | 'firma' | 'caducado' | 'contenido' }

export function verifyState(state: string | null | undefined, now = Date.now()): VerifyResult {
  if (!state || typeof state !== 'string') return { ok: false, reason: 'formato' }
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'formato' }
  const [body, mac] = parts

  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest()
  let given: Buffer
  try {
    given = Buffer.from(mac, 'base64url')
  } catch {
    return { ok: false, reason: 'formato' }
  }
  // timingSafeEqual exige la misma longitud, y lanza si no coincide: se comprueba antes para que un
  // mac de longitud distinta devuelva 'firma' y no una excepción.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'firma' }
  }

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'contenido' }
  }
  if (
    !payload ||
    typeof payload.tenant !== 'string' ||
    !payload.tenant ||
    (payload.provider !== 'ga4' && payload.provider !== 'gmail') ||
    typeof payload.iat !== 'number'
  ) {
    return { ok: false, reason: 'contenido' }
  }
  // Se rechaza también un iat en el futuro: indica un reloj manipulado o un state fabricado.
  if (payload.iat > now + 60_000) return { ok: false, reason: 'caducado' }
  if (now - payload.iat > STATE_TTL_MS) return { ok: false, reason: 'caducado' }

  return { ok: true, payload }
}
