import crypto from 'node:crypto'

export type MetaOAuthSurface = 'meta' | 'instagram'

type Payload = {
  tenant: string
  surface: MetaOAuthSurface
  userId: string
  nonce: string
  exp: number
}

const TTL_MS = 10 * 60 * 1000

function key(): Buffer {
  const master = process.env.CONFIG_ENC_KEY
  if (!master) throw new Error('CONFIG_ENC_KEY no configurada')
  return crypto.createHmac('sha256', master).update('meta-oauth-state-v1').digest()
}

export function signMetaState(input: Omit<Payload, 'nonce' | 'exp'>): string {
  const payload: Payload = {
    ...input,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + TTL_MS,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyMetaState(raw: string | null): { ok: true; payload: Payload } | { ok: false } {
  if (!raw) return { ok: false }
  const [encoded, received, extra] = raw.split('.')
  if (!encoded || !received || extra) return { ok: false }
  const expected = crypto.createHmac('sha256', key()).update(encoded).digest()
  let receivedBuffer: Buffer
  try {
    receivedBuffer = Buffer.from(received, 'base64url')
  } catch {
    return { ok: false }
  }
  if (receivedBuffer.length !== expected.length || !crypto.timingSafeEqual(receivedBuffer, expected)) {
    return { ok: false }
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<Payload>
    if (
      typeof payload.tenant !== 'string' ||
      typeof payload.userId !== 'string' ||
      (payload.surface !== 'meta' && payload.surface !== 'instagram') ||
      typeof payload.nonce !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < Date.now()
    ) {
      return { ok: false }
    }
    return { ok: true, payload: payload as Payload }
  } catch {
    return { ok: false }
  }
}
