'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

// Red de seguridad: sin esto, un error de render en cualquier página de /evergreen dejaba la
// pantalla en blanco/"congelada" sin ninguna pista de qué había pasado (el reporte de "la app se
// queda bloqueada al filtrar en Ventas" era imposible de diagnosticar sin esto). Ahora se ve el
// mensaje del error y se puede copiar/pegar, y hay un botón para reintentar sin recargar todo.
export default function EvergreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(`[evergreen] Error de render capturado:`, error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-xl border border-red-500/30 bg-red-500/5 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-foreground font-semibold">Algo ha fallado en esta pantalla</h2>
            <p className="text-sm text-muted-foreground mt-1">
              No es que se haya quedado colgada: ha ocurrido un error y no se ha podido pintar la página.
              Copia el mensaje de abajo y pásaselo al equipo para arreglarlo.
            </p>
          </div>
        </div>
        <pre className="text-xs text-red-300 bg-background/60 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
          {error.message || 'Error desconocido'}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium"
        >
          <RotateCcw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    </div>
  )
}
