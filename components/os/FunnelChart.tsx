'use client'

// Funnel VISUAL: la reducción entre etapas se ve, no se deduce de seis tarjetas seguidas.
//
// DECISIONES, para que no se deshagan por descuido:
//
// · La forma la da el ANCHO de cada barra, centrada: eso es lo que hace legible la caída de un
//   vistazo. No hay polígono 3D ni infografía: una etapa con la mitad de volumen ocupa la mitad.
// · El color sale de `--primary`, el token que `app/[tenant]/layout.tsx` reescribe según
//   `data-accent`. Así el funnel es rosa en Women Digital Closer y azul en Evergreen sin una sola
//   línea de color por subcuenta. Un solo tono con opacidad creciente hacia la conversión final:
//   ni arcoíris ni un hue por etapa (el ancho ya codifica la magnitud, el color no la duplica).
// · Los números y las etiquetas van con tokens de TEXTO, nunca con el color de la serie: el color
//   identifica la barra, el texto tiene que ser legible sobre el fondo.
// · UN HUECO NO ES UN CERO. Si la fuente de una etapa falló o no está configurada, la barra sale
//   rayada con el motivo, no a 0. Pintar 0 convierte "la integración está caída" en "esta campaña
//   no convierte", que es el error que este módulo existe para evitar (ver lib/funnels/types.ts).
// · La animación es CSS (ancho + opacidad, escalonada por fila) y se desactiva sola con
//   `prefers-reduced-motion`. No se añadió framer-motion: una transición de ancho no justifica una
//   dependencia, y un fondo animado detrás de datos es ruido, no producto.
// · Hay tabla equivalente en un <details>: quien no pueda leer la gráfica tiene los mismos números.

import { useId, useState } from 'react'
import { AlertTriangle, Loader2, Settings2 } from 'lucide-react'
import type { FunnelResult, StageResult } from '@/lib/funnels/compute'
import { isUsable, STATUS_LABELS } from '@/lib/funnels/types'

type FunnelChartState = 'loading' | 'not_connected' | 'error' | 'ok'

type Props = {
  result: FunnelResult | null
  /** Estado de la CARGA, distinto del estado de cada métrica (§45). */
  state?: FunnelChartState
  /** Mensaje cuando `state` es 'error' o 'not_connected'. */
  message?: string
  /** Abre los registros que componen una etapa (§37). Solo se ofrece si la etapa sabe a dónde ir. */
  onStageClick?: (stage: StageResult) => void
  /** La tabla equivalente. Se puede apagar donde la pantalla ya tiene una debajo. */
  tabla?: boolean
  className?: string
}

const nf = new Intl.NumberFormat('es-ES')
const fmt = (n: number) => nf.format(Math.round(n))
const fmtPct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`

/** Ancho de la barra: proporción respecto a la PRIMERA etapa con dato. La cima es el 100 %. */
function anchos(stages: StageResult[]): number[] {
  const primera = stages.find((s) => isUsable(s.count))?.count.value ?? 0
  return stages.map((s) => {
    if (!isUsable(s.count) || !primera) return 1
    // Suelo del 6 %: una etapa con muy poco volumen tiene que seguir siendo visible y clicable.
    return Math.max(6, ((s.count.value ?? 0) / primera) * 100)
  })
}

function Contenedor({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`border-border bg-card rounded-2xl border p-5 ${className ?? ''}`}>{children}</div>
}

export function FunnelChart({ result, state = 'ok', message, onStageClick, tabla = true, className }: Props) {
  const rayadoId = useId().replace(/:/g, '')
  const [activa, setActiva] = useState<string | null>(null)

  if (state === 'loading') {
    return (
      <Contenedor className={className}>
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando el embudo…
        </div>
        <div className="mt-4 space-y-2" aria-hidden>
          {[100, 74, 48, 30, 18].map((w, i) => (
            <div key={i} className="bg-muted mx-auto h-9 animate-pulse rounded-lg" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Contenedor>
    )
  }

  if (state === 'not_connected' || state === 'error' || !result) {
    const esError = state === 'error'
    return (
      <Contenedor className={className}>
        <div className="flex items-start gap-3">
          {esError ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          ) : (
            <Settings2 className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <div>
            <p className="text-sm font-medium">
              {esError ? 'No se pudo calcular el embudo' : 'Faltan fuentes por conectar'}
            </p>
            {/* Ni un 0 ni un embudo vacío: se dice qué pasa. */}
            <p className="text-muted-foreground mt-1 text-sm">
              {message ?? (esError ? 'Vuelve a intentarlo en un momento.' : 'Conecta las fuentes de estas etapas.')}
            </p>
          </div>
        </div>
      </Contenedor>
    )
  }

  const stages = result.stages
  const ws = anchos(stages)
  const sinNingunDato = stages.every((s) => !isUsable(s.count))

  return (
    <Contenedor className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{result.label}</h3>
        {result.incomplete ? (
          // PARTIAL_DATA: el embudo se pinta, pero diciendo que le falta una pata.
          <span className="text-xs text-amber-400">
            Incompleto: {[...result.failedSources, ...result.unconfiguredSources].join(', ')}
          </span>
        ) : null}
      </div>

      {sinNingunDato ? (
        <p className="text-muted-foreground mt-4 text-sm">
          Sin datos en el periodo seleccionado. Prueba a ampliar el rango.
        </p>
      ) : (
        <>
          {/* Rayado del hueco: se define una vez y lo referencian todas las barras sin dato. */}
          <svg className="absolute h-0 w-0" aria-hidden>
            <defs>
              <pattern id={rayadoId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="hsl(var(--muted))" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--border))" strokeWidth="2" />
              </pattern>
            </defs>
          </svg>

          <ol className="funnel-chart mt-4 space-y-1.5">
            {stages.map((s, i) => {
              const usable = isUsable(s.count)
              const clicable = !!onStageClick && !!s.stage.drilldown && usable && (s.count.value ?? 0) > 0
              const perdidos =
                i > 0 && usable && isUsable(stages[i - 1].count)
                  ? (stages[i - 1].count.value ?? 0) - (s.count.value ?? 0)
                  : null
              const Fila = clicable ? 'button' : 'div'
              return (
                <li key={s.stage.id}>
                  <Fila
                    {...(clicable
                      ? {
                          type: 'button' as const,
                          onClick: () => onStageClick?.(s),
                          'aria-label': `Ver los registros de ${s.stage.label}`,
                        }
                      : {})}
                    onMouseEnter={() => setActiva(s.stage.id)}
                    onMouseLeave={() => setActiva(null)}
                    onFocus={() => setActiva(s.stage.id)}
                    onBlur={() => setActiva(null)}
                    className={`group relative block w-full text-left ${clicable ? 'cursor-pointer' : ''}`}
                  >
                    {/* La barra: centrada, para que el estrechamiento se lea como un embudo. */}
                    <div
                      className="funnel-bar border-border/60 relative mx-auto flex min-h-11 items-center justify-between gap-3 overflow-hidden rounded-lg border px-3 py-2 transition-[width,opacity] duration-500"
                      style={{
                        width: `${ws[i]}%`,
                        // Un solo tono, más presencia al acercarse a la conversión final.
                        background: usable
                          ? `hsl(var(--primary) / ${(0.18 + (i / Math.max(1, stages.length - 1)) * 0.34).toFixed(3)})`
                          : undefined,
                        ['--fila' as string]: String(i),
                      }}
                    >
                      {!usable ? (
                        <span
                          className="absolute inset-0"
                          style={{ background: `url(#${rayadoId})`, backgroundColor: 'hsl(var(--muted) / 0.5)' }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="text-foreground relative truncate text-xs font-medium">{s.stage.label}</span>
                      <span className="text-foreground relative shrink-0 text-sm font-semibold tabular-nums">
                        {usable ? fmt(s.count.value ?? 0) : '—'}
                      </span>
                    </div>

                    {/* Debajo de cada barra: conversión desde la anterior y cuántos se pierden. */}
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-1 text-xs">
                      {!usable ? (
                        <span className="text-amber-400">{s.count.error || STATUS_LABELS[s.count.status]}</span>
                      ) : (
                        <>
                          {s.conversionFromPrevious != null ? (
                            <span className="tabular-nums">{fmtPct(s.conversionFromPrevious)} desde la anterior</span>
                          ) : i > 0 ? (
                            <span>conversión no calculable</span>
                          ) : null}
                          {perdidos != null && perdidos > 0 ? (
                            <span className="tabular-nums">−{fmt(perdidos)} se caen</span>
                          ) : null}
                          {activa === s.stage.id && s.conversionFromTop != null && i > 0 ? (
                            <span className="tabular-nums">{fmtPct(s.conversionFromTop)} del total</span>
                          ) : null}
                          {activa === s.stage.id && s.costPerUnit != null ? (
                            <span className="tabular-nums">{fmt(s.costPerUnit)} € por unidad</span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </Fila>
                </li>
              )
            })}
          </ol>

          {/* Los mismos números en tabla, para quien no pueda leer la gráfica. */}
          {tabla ? (
            <details className="mt-4">
              <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">Ver como tabla</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Etapa</th>
                      <th className="py-1 pr-3 text-right font-medium">Volumen</th>
                      <th className="py-1 pr-3 text-right font-medium">Desde anterior</th>
                      <th className="py-1 text-right font-medium">Del total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((s) => (
                      <tr key={s.stage.id} className="border-border/60 border-t">
                        <td className="py-1 pr-3">{s.stage.label}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {isUsable(s.count) ? fmt(s.count.value ?? 0) : STATUS_LABELS[s.count.status]}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {s.conversionFromPrevious != null ? fmtPct(s.conversionFromPrevious) : '—'}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {s.conversionFromTop != null ? fmtPct(s.conversionFromTop) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}
    </Contenedor>
  )
}
