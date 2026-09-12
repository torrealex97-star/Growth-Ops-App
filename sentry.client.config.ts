import * as Sentry from '@sentry/nextjs'

// Inerte si no hay DSN (dev local, o hasta que se configure en el hosting). Nunca mandamos
// PII de contacto ni credenciales — solo tenant_id/route/request_id, puestos vía withSentryTags.
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
