import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// SaaS Nivel 1 — configuración de integraciones por instalación.
//
// Las credenciales (Meta, Instagram, Calendly, Email, GHL, negocio) se guardan en
// la tabla `integration_settings` (cifradas si son secretas) y se leen SOLO en
// servidor con service-role. `ensureConfig()` las vuelca a process.env al inicio
// de cada request de integración, de modo que TODO el código existente que hace
// `process.env.X` sigue funcionando sin cambios. El env de Vercel queda como
// fallback (para las claves que no se hayan configurado desde la app).
// ─────────────────────────────────────────────────────────────────────────────

const ENC_PREFIX = 'enc:v1:'

function encKey(): Buffer | null {
  const k = process.env.CONFIG_ENC_KEY
  if (!k) return null
  // Derivar 32 bytes de la clave maestra (acepta cualquier longitud/formato).
  return crypto.createHash('sha256').update(k, 'utf8').digest()
}

export function encryptSecret(plain: string): string {
  const key = encKey()
  if (!key) throw new Error('CONFIG_ENC_KEY no configurada (no se pueden cifrar secretos)')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored
  const key = encKey()
  if (!key) throw new Error('CONFIG_ENC_KEY no configurada (no se pueden descifrar secretos)')
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(ENC_PREFIX)
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Cache = { at: number; vals: Record<string, string> }
let cache: Cache | null = null
const TTL_MS = 30_000

// Vuelca los valores configurados a process.env (solo los que tengan valor; el env
// existente actúa de fallback para lo no configurado). Cacheado 30s por proceso.
export async function ensureConfig(force = false): Promise<void> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    apply(cache.vals)
    return
  }
  try {
    const { data, error } = await svc()
      .from('integration_settings')
      .select('key,value,is_secret')
    if (error) return // tabla aún no migrada → usar solo env
    const vals: Record<string, string> = {}
    for (const row of data ?? []) {
      const raw = (row as { value: string | null }).value
      if (!raw) continue
      let v = raw
      if ((row as { is_secret: boolean }).is_secret && isEncrypted(raw)) {
        try { v = decryptSecret(raw) } catch { continue }
      }
      vals[(row as { key: string }).key] = v
    }
    cache = { at: Date.now(), vals }
    apply(vals)
  } catch {
    // Sin BBDD/tabla → seguimos con el env de Vercel.
  }
}

function apply(vals: Record<string, string>) {
  for (const [k, v] of Object.entries(vals)) {
    if (v) process.env[k] = v
  }
}

// Invalida la caché (llamar tras guardar en el panel).
export function invalidateConfigCache() {
  cache = null
}
