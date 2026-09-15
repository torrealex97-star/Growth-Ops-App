'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { normalizarRutaTenant } from '@/lib/observability/peticion'

// Red de seguridad: sin esto, un error de render en cualquier página de /evergreen dejaba la
// pantalla en blanco/"congelada" sin ninguna pista de qué había pasado (el reporte de "la app se
// queda bloqueada al filtrar en Ventas" era imposible de diagnosticar sin esto). Ahora Sentry recibe
// la excepción con una ruta agrupable y hay un botón para reintentar sin recargar todo. El mensaje
// técnico no se imprime en pantalla: puede contener detalles internos o datos sensibles.
export default function EvergreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname()
  const [eventId, setEventId] = useState<string | null>(null)

  useEffect(() => {
    const capturedId = Sentry.captureException(error, {
      tags: { route: normalizarRutaTenant(pathname) },
    })
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) setEventId(capturedId)
  }, [error, pathname])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div role="alert" className="max-w-lg w-full rounded-xl border border-red-500/30 bg-red-500/5 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-foreground font-semibold">Algo ha fallado en esta pantalla</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Ha ocurrido un error y no se ha podido pintar la página. Puedes reintentar sin perder la ruta en la que
              estabas.
            </p>
          </div>
        </div>
        {(eventId || error.digest) && (
          <p className="text-xs text-muted-foreground">
            Referencia: <code>{eventId || error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    </div>
  )
}
