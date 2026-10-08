const MAX_TEXT_LENGTH = 240

export type CspViolation = {
  directive: string
  effectiveDirective: string | null
  blockedOrigin: string
  documentOrigin: string
  disposition: 'report' | 'enforce' | 'unknown'
  statusCode: number | null
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean ? clean.slice(0, MAX_TEXT_LENGTH) : null
}

/**
 * Conserva solo el origen. Paths, queries y fragmentos pueden contener tokens, IDs o PII y no son
 * necesarios para saber qué host falta en la política.
 */
export function originSeguro(value: unknown): string {
  const raw = text(value)
  if (!raw) return 'desconocido'
  if (raw === 'inline' || raw === 'eval' || raw === 'data' || raw === 'blob') return raw
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return 'otro-esquema'
    }
    return url.origin.slice(0, MAX_TEXT_LENGTH)
  } catch {
    return 'desconocido'
  }
}

function normalizar(raw: UnknownRecord): CspViolation | null {
  const directive = text(raw['violated-directive'] ?? raw.violatedDirective)
  if (!directive) return null
  const dispositionRaw = text(raw.disposition)
  const disposition = dispositionRaw === 'report' || dispositionRaw === 'enforce' ? dispositionRaw : 'unknown'
  const status = raw['status-code'] ?? raw.statusCode
  return {
    directive,
    effectiveDirective: text(raw['effective-directive'] ?? raw.effectiveDirective),
    blockedOrigin: originSeguro(raw['blocked-uri'] ?? raw.blockedURL),
    documentOrigin: originSeguro(raw['document-uri'] ?? raw.documentURL ?? raw.url),
    disposition,
    statusCode: typeof status === 'number' && Number.isFinite(status) ? status : null,
  }
}

/** Acepta el formato CSP clásico y Reporting API, sin conservar el payload original. */
export function parsearInformesCsp(payload: unknown): CspViolation[] {
  const entradas = Array.isArray(payload) ? payload : [payload]
  const violations: CspViolation[] = []
  for (const entrada of entradas.slice(0, 20)) {
    const outer = record(entrada)
    if (!outer) continue
    const classic = record(outer['csp-report'])
    const body = record(outer.body)
    const raw = classic ?? body ?? outer
    const violation = normalizar(raw)
    if (violation) violations.push(violation)
  }
  return violations
}
