// ─────────────────────────────────────────────────────────────────────────────
// ESTADOS DEL CICLO DE VIDA DEL EMAIL (módulo PURO, sin Node ni Supabase)
// ─────────────────────────────────────────────────────────────────────────────
// Lo importan el EmailService, el webhook y los tests (node:test puede importar
// .ts directamente). Mantener la lógica de decisión aquí la hace ejecutable:
// mapper de eventos, orden de la línea temporal y decisión de carrera del
// webhook (evento que llega antes de que el INSERT del envío se haya commitado).

export type EmailStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'OPENED' | 'CLICKED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED'

// Eventos de Resend (namespaces `email.*`) → estado interno.
export function mapResendEventToStatus(type: string): EmailStatus | null {
  switch (type) {
    case 'email.sent':
      return 'SENT'
    case 'email.delivered':
      return 'DELIVERED'
    case 'email.opened':
      return 'OPENED'
    case 'email.clicked':
      return 'CLICKED'
    case 'email.bounced':
    case 'email.bounced.hard':
    case 'email.bounced.soft':
      return 'BOUNCED'
    case 'email.complained':
      return 'COMPLAINED'
    case 'email.failed':
      return 'FAILED'
    default:
      return null
  }
}

// ¿El nuevo estado avanza la línea temporal? (DELIVERED nunca vuelve a SENT;
// fallos terminales comparten rango con el último hito positivo.)
const ORDER: Record<EmailStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  OPENED: 3,
  CLICKED: 4,
  BOUNCED: 5,
  COMPLAINED: 5,
  FAILED: 5,
}

export function shouldAdvanceStatus(current: string, next: EmailStatus): boolean {
  return (ORDER[next] ?? 0) > (ORDER[current as EmailStatus] ?? 0)
}

// ── Carrera del webhook ──────────────────────────────────────────────────────
// El webhook puede ejecutarse ANTES de que recordMessage haya commitado su
// INSERT (el send devuelve → Resend dispara el evento → nuestro INSERT sigue
// en vuelo). Resend reintenta cuando respondemos no-2xx, así que:
//   · verificado + evento reciente  → 'retry' (500): Resend re-entregará y
//     para entonces el INSERT ya existirá.
//   · evento viejo (> 10 min)       → 'ignore' (200): un id desconocido con
//     esa edad no es una carrera; reintentar sería eterno.
//   · modo inseguro de desarrollo   → 'ignore': sin verificación no hay que
//     provocar tormentas de reintentos.
export const MISSING_MESSAGE_MAX_AGE_SEC = 600

export function missingMessageAction(opts: {
  verified: boolean
  /** Edad del evento en segundos según svix-timestamp; null si se desconoce. */
  eventAgeSec: number | null
}): 'retry' | 'ignore' {
  if (!opts.verified) return 'ignore'
  if (opts.eventAgeSec === null) return 'retry'
  return opts.eventAgeSec <= MISSING_MESSAGE_MAX_AGE_SEC ? 'retry' : 'ignore'
}
