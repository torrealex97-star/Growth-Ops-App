import crypto from 'crypto'

/**
 * Hash de credenciales almacenadas (códigos de autorización, access tokens, refresh tokens y
 * client secrets): SHA-256 hex. Un volcado de la tabla nunca revela la credencial en claro.
 * Se usa SHA-256 directo (no bcrypt) porque las credenciales generadas por el servidor son
 * aleatorias de 256 bits — no hay contraseña humana que acelerar.
 */
export function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** Verificación en tiempo constante de un secreto presentado contra su hash. */
export function secretMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(presented), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * JWT firmado HS256 con sesión corta (15 min). La firma vive en MCP_JWT_SECRET (32 bytes
 * como mínimo; sin la variable el servidor MCP queda cerrado y responde 503 — nunca se
 * genera una clave ad hoc que invalidaría todos los tokens en el siguiente arranque).
 */
export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + expiresInSeconds }
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const signingInput = `${enc(header)}.${enc(body)}`
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, sig] = parts
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')
  const a = Buffer.from(sig)
  const c = Buffer.from(expected)
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
  return payload
}
