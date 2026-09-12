import * as Sentry from '@sentry/nextjs'

// Runtime edge (middleware) — sin acceso a Node APIs, sin scrubbing adicional necesario porque
// el middleware de este repo no maneja PII directamente.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
})
