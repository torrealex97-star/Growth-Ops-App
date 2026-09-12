import * as Sentry from '@sentry/nextjs'

// Inerte si no hay DSN. `requireTenant()` resuelve tenantId/route en casi todos los endpoints —
// se etiqueta el scope con `withSentryTags` (lib/observability/sentry.ts) en cada route handler.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    scrubSensitive(event)
    return event
  },
})

const SENSITIVE_KEYS = /password|token|secret|service_role|authorization|cookie/i

function scrubSensitive(event: Sentry.ErrorEvent) {
  const extra = event.extra
  if (extra) {
    for (const key of Object.keys(extra)) {
      if (SENSITIVE_KEYS.test(key)) delete extra[key]
    }
  }
  if (event.request?.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (SENSITIVE_KEYS.test(key)) delete event.request.headers[key]
    }
  }
  if (event.request) {
    delete event.request.cookies
  }
}
