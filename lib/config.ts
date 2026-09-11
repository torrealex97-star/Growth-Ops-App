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
// Multi-tenant: cada subcuenta tiene sus propias credenciales en `integration_settings`
// (columna tenant_id). Antes esto era un único `Cache | null` global, compartido por TODAS
// las peticiones que atendiera la misma instancia de servidor durante 30s — con varias
// subcuentas, las credenciales de un tenant podían pisar las de otro en process.env durante
// ese margen. Ahora la caché va indexada por tenantId, y cada llamada exige un tenantId
// explícito (nada de "config por defecto").
const cacheByTenant = new Map<string, Cache>()
const TTL_MS = 30_000

// Vuelca los valores configurados de UN tenant a process.env (solo los que tengan valor; el
// env existente actúa de fallback para lo no configurado). Cacheado 30s por tenant/proceso.
export async function ensureConfig(tenantId: string, force = false): Promise<void> {
  if (!tenantId) return // sin tenant no hay config de integración que cargar
  const cached = cacheByTenant.get(tenantId)
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    apply(cached.vals)
    return
  }
  try {
    const { data, error } = await svc()
      .from('integration_settings')
      .select('key,value,is_secret')
      .eq('tenant_id', tenantId)
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
    cacheByTenant.set(tenantId, { at: Date.now(), vals })
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

// Invalida la caché (llamar tras guardar en el panel). Sin tenantId, invalida TODAS
// las subcuentas (usar solo en contextos sin tenant conocido).
export function invalidateConfigCache(tenantId?: string) {
  if (tenantId) cacheByTenant.delete(tenantId)
  else cacheByTenant.clear()
}
