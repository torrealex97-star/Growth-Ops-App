'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Orbita } from './Orbita'
import { useFaseCarga } from './useFaseCarga'

// EL LOADER DE PANTALLA COMPLETA, y lo que cambia respecto al que había.
//
// El anterior (app/[tenant]/layout.tsx) era un `<div className="dark ... bg-background">` con el texto
// "Cargando {marca}...". Eso es la pantalla negra: `dark` + `bg-background` es casi negro, sustituía la
// aplicación ENTERA —sidebar y header incluidos— y, si la carga no terminaba, se quedaba así para
// siempre sin decir nada ni ofrecer salida.
//
// Aquí: fondo del tema (no negro forzado), mensaje contextual en vez de "Cargando", nada antes de
// 300 ms para que una carga rápida no parpadee, y a los 6 segundos se admite que algo va mal y se dan
// dos salidas reales. `role="status"` + `aria-live="polite"` para que un lector de pantalla lo anuncie.

export type AppLoadingProps = {
  /** Qué se está haciendo, en concreto. "Cargando" no dice nada: "Preparando la agenda…" sí. */
  mensaje?: string
  /** Se ofrece cuando la carga se alarga. Si no se pasa, no se enseña el botón. */
  onReintentar?: () => void
  /** Salida alternativa cuando reintentar no arregla nada. */
  onVolver?: () => void
  cargando?: boolean
}

export function AppLoading({
  mensaje = 'Cargando tu espacio…',
  onReintentar,
  onVolver,
  cargando = true,
}: AppLoadingProps) {
  const fase = useFaseCarga(cargando)
  // Antes de 300 ms no se pinta NADA. La mayoría de las cargas caben aquí.
  if (fase === 'oculto') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center"
    >
      <Orbita />
      <p className="text-sm text-muted-foreground">{mensaje}</p>

      {fase === 'lento' && (
        <div className="flex flex-col items-center gap-3">
          {/* Se dice la verdad: no se inventa un porcentaje de progreso que nadie está midiendo. */}
          <p className="max-w-xs text-xs text-muted-foreground/80">
            Está tardando más de lo normal. Puede ser la conexión o el servidor.
          </p>
          <div className="flex gap-2">
            {onReintentar && (
              <button
                type="button"
                onClick={onReintentar}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Reintentar
              </button>
            )}
            {onVolver && (
              <button
                type="button"
                onClick={onVolver}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Volver
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Loader en línea, para dentro de un botón o una celda. No tiene fases: quien lo pone ya ha decidido
 * que ese hueco concreto está esperando.
 */
export function InlineSpinner({ etiqueta = 'Cargando' }: { etiqueta?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <Orbita tamano={16} />
      <span className="sr-only">{etiqueta}</span>
    </span>
  )
}

/**
 * Esqueleto de contenido. Se usa cuando SE SABE la forma de lo que viene: una tabla de N filas, una
 * rejilla de tarjetas. Un esqueleto con la forma equivocada desplaza el contenido al llegar (CLS), así
 * que las medidas las pone quien lo llama.
 */
export function PageSkeleton({
  filas = 6,
  alturaFila = 44,
  cargando = true,
  etiqueta = 'Cargando datos…',
}: {
  filas?: number
  alturaFila?: number
  cargando?: boolean
  etiqueta?: string
}) {
  const fase = useFaseCarga(cargando)
  if (fase === 'oculto') return null
  return (
    <div role="status" aria-live="polite" className="w-full space-y-2">
      <span className="sr-only">{etiqueta}</span>
      {/* Se usa el primitivo `Skeleton` que ya existía en components/ui (estaba escrito y SIN USAR, lo
          detectó knip): duplicarlo aquí habría dejado dos rectángulos grises distintos en la misma app.
          Su `animate-pulse` respeta prefers-reduced-motion gracias a la regla global de
          app/globals.css, que de paso cubre los ~18 spinners que ya había por las pantallas. */}
      {Array.from({ length: filas }).map((_, i) => (
        <Skeleton key={i} className="w-full" style={{ height: alturaFila, animationDelay: `${i * 70}ms` }} />
      ))}
      {fase === 'lento' && <p className="pt-1 text-xs text-muted-foreground/80">Está tardando más de lo normal…</p>}
    </div>
  )
}

/**
 * Progreso de una sincronización.
 *
 * `hechos`/`total` son reales o no se pasan: una barra que avanza sola mientras nadie mide nada es una
 * mentira con forma de barra. Sin total conocido se enseña el contador de lo ya procesado, que sí es
 * un hecho.
 */
export function SyncProgress({
  titulo,
  hechos,
  total,
  detalle,
}: {
  titulo: string
  hechos?: number | null
  total?: number | null
  detalle?: string
}) {
  const conocido = typeof hechos === 'number' && typeof total === 'number' && total > 0
  const pct = conocido ? Math.min(100, Math.round((hechos / total) * 100)) : null
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Orbita tamano={18} />
        <span className="text-sm font-medium text-foreground">{titulo}</span>
        {pct !== null && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{pct}%</span>}
      </div>
      {pct !== null ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: 'var(--brand-600, #6366f1)' }}
          />
        </div>
      ) : (
        typeof hechos === 'number' && <p className="text-xs tabular-nums text-muted-foreground">{hechos} procesados…</p>
      )}
      {detalle && <p className="text-xs text-muted-foreground/80">{detalle}</p>}
    </div>
  )
}
