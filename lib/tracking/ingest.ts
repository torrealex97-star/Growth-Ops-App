// Helpers PUROS de la ingesta del pixel first-party (Fase C de TRACKING_ARCHITECTURE_MAP).
// Sin I/O para que los tests no necesiten red ni BD: las rutas los componen con el cliente
// de Supabase. El modelo de datos (tracking_sites / raw_events / canonical_events) ya existe
// en la migración 20260915100000; esto es la capa de aplicación que faltaba.

export type BotClassification = 'likely_bot' | 'likely_human' | 'unknown'

/**
 * Clasificación de bots (§18 del mapa de tracking): TRES estados, nunca un booleano.
 * Heurística de user-agent conservadora: los patrones conocidos marcan 'likely_bot';
 * sin UA (peticiones sin cabecera) es 'unknown', que NO es un bot.
 */
export function classifyBot(userAgent: string | null | undefined): BotClassification {
  if (!userAgent || userAgent.trim() === '') return 'unknown'
  const ua = userAgent.toLowerCase()
  const BOT_PATTERNS = [
    'bot', 'crawler', 'spider', 'crawling', 'slurp', 'bingpreview', 'yandex',
    'facebookexternalhit', 'linkedinbot', 'twitterbot', 'whatsapp', 'telegrambot',
    'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'lighthouse', 'pagespeed',
    'curl/', 'wget/', 'python-requests', 'axios/', 'node-fetch', 'postman',
  ]
  if (BOT_PATTERNS.some((p) => ua.includes(p))) return 'likely_bot'
  // UA mínimamente plausible (algo/navegador) y sin patrones → humano probable.
  if (ua.includes('mozilla') || ua.includes('safari') || ua.includes('chrome')) return 'likely_human'
  return 'unknown'
}

/**
 * ¿El Origin de la petición está autorizado para este site?
 * Comparación por esquema+host SIN barra final (así se guardan en allowed_origins).
 * allow_localhost abre http://localhost[:puerto] y http://127.0.0.1[:puerto] para desarrollo.
 * Origin null (mismo origen sin cabecera, sendBeacon de algunos contextos) se permite solo si
 * la petición llega del mismo host que sirve el pixel — el navegador SIEMPRE manda Origin en
 * sendBeacon/fetch cross-origin, así que null solo ocurre en same-origin: no se rechaza.
 */
export function originAllowed(
  origin: string | null,
  allowedOrigins: string[],
  allowLocalhost: boolean
): boolean {
  if (!origin) return true
  const normalized = origin.replace(/\/+$/, '')
  if (allowedOrigins.includes(normalized)) return true
  if (allowLocalhost) {
    try {
      const u = new URL(normalized)
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true
    } catch {
      /* origin malformado → no permitido */
    }
  }
  return false
}

/** Clave PÚBLICA nueva con el formato que exige el constraint de tracking_sites. */
export function newPublicKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let out = ''
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(40))
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return `gop_pk_${out}`
}

/** Hash con sal de servidor de la IP (§78): sirve para abuso/rate limit sin conservar la IP. */
export function hashIp(ip: string | null | undefined, salt: string | undefined): string | null {
  if (!ip) return null
  // Síncrono a propósito: djb2 es suficiente para diferenciar IPs sin ser reversible a datos
  // personales, y evita async en el hot path de ingesta. NO es criptografía: es pseudonimización.
  const input = `${salt ?? ''}:${ip}`
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** El pixel solo acepta los nombres de evento del brief: snake_case, 2-60 chars. */
export function isValidEventName(name: string): boolean {
  return /^[a-z][a-z0-9_]{1,59}$/.test(name)
}

/**
 * Límite de eventos por minuto y clave (§17). En memoria del proceso: en serverless cada
 * instancia cuenta lo suyo, así que es un TECHO best-effort (lo fuerte es el constraint de BD
 * por tamaño, y el abuso sostenido se ve en raw_events). Suficiente para frenar un script
 * desbocado sin infraestructura extra.
 */
export class MinuteRateLimiter {
  private hits = new Map<string, number[]>()
  private readonly windowMs: number
  constructor(windowMs = 60_000) {
    this.windowMs = windowMs
  }
  allow(key: string, limit: number, now = Date.now()): boolean {
    const cut = now - this.windowMs
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cut)
    if (arr.length >= limit) {
      this.hits.set(key, arr)
      return false
    }
    arr.push(now)
    this.hits.set(key, arr)
    // Higiene: si el mapa crece mucho (abuso con claves inventadas), purga ventanas viejas.
    if (this.hits.size > 10_000) {
      for (const [k, ts] of this.hits) {
        if (ts.length === 0 || ts[ts.length - 1] < cut) this.hits.delete(k)
      }
    }
    return true
  }
}

/** Canal de negocio derivado del primer touch: lo que las métricas ya agrupan por fuente. */
export function deriveChannel(
  utmSource: string | null | undefined,
  referrer: string | null | undefined
): string {
  const s = (utmSource ?? '').toLowerCase()
  if (s) return s
  if (!referrer) return 'direct'
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '')
    const SOCIAL = ['instagram', 'facebook', 'tiktok', 'youtube', 'x.com', 'twitter', 'linkedin']
    const social = SOCIAL.find((d) => host.includes(d))
    if (social) return social === 'x.com' ? 'twitter' : social
    if (host.includes('google')) return 'google'
    return host
  } catch {
    return 'referral'
  }
}
