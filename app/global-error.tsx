'use client'

import { useEffect, useState } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [eventId, setEventId] = useState<string | null>(null)

  useEffect(() => {
    const capturedId = Sentry.captureException(error, { tags: { route: 'global' } })
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) setEventId(capturedId)
  }, [error])

  return (
    <html lang="es">
      <body className="bg-zinc-950 text-zinc-50 antialiased">
        <main className="flex min-h-screen items-center justify-center px-6">
          <div role="alert" className="w-full max-w-md space-y-4 text-center">
            <h1 className="text-xl font-semibold">No se ha podido abrir la aplicación</h1>
            <p className="text-sm text-zinc-400">Reintenta para recuperar la sesión y volver a la aplicación.</p>
            {(eventId || error.digest) && (
              <p className="text-xs text-zinc-500">
                Referencia: <code>{eventId || error.digest}</code>
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
