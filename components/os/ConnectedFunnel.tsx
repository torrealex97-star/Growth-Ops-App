import { Fragment } from 'react'
import { formatNumber, formatPercent } from '@/lib/utils'

export interface ConnectedFunnelStage {
  label: string
  value: number
  conversion?: number | null
}

/** Diagrama de etapas: la silueta es esquemática, no una escala de volúmenes. */
export function ConnectedFunnel({
  stages,
  loading = false,
  activityOnly = false,
  compact = false,
}: {
  stages: ConnectedFunnelStage[]
  loading?: boolean
  compact?: boolean
  activityOnly?: boolean
}) {
  if (loading) return <div className={`${compact ? 'h-36' : 'h-64'} motion-safe:animate-pulse rounded-xl bg-muted`} />

  const connectorHeight = compact ? 144 : 240

  const height = (index: number) =>
    (compact ? 120 : 240) - (index / Math.max(stages.length - 1, 1)) * (compact ? 60 : 120)
  return (
    <div className="connected-funnel">
      <div
        className="connected-funnel-horizontal overflow-x-auto pb-3"
        tabIndex={0}
        role="region"
        aria-label="Etapas del embudo de conversión"
      >
        <div
          className={`flex items-center ${compact ? 'h-36' : 'h-64'}`}
          style={{
            minWidth:
              stages.reduce((sum, stage) => sum + Math.max(130, formatNumber(stage.value).length * 18 + 40), 0) +
              (stages.length - 1) * 64,
          }}
        >
          {stages.map((stage, index) => (
            <Fragment key={stage.label}>
              {index > 0 && (
                <div
                  className="relative flex w-16 shrink-0 items-center justify-center"
                  style={{ height: connectorHeight }}
                >
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 64 ${connectorHeight}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <polygon
                      points={`0,${(connectorHeight - height(index - 1)) / 2} 64,${(connectorHeight - height(index)) / 2} 64,${(connectorHeight + height(index)) / 2} 0,${(connectorHeight + height(index - 1)) / 2}`}
                      fill={`color-mix(in srgb, hsl(var(--brand-300)) ${100 - index * 8}%, hsl(var(--brand-500)))`}
                    />
                  </svg>
                  <div className="relative text-center text-slate-950">
                    <p className="text-sm font-semibold tabular-nums">
                      {activityOnly ? '' : formatPercent(stage.conversion, 1)}
                    </p>
                    <span className="text-2xl" aria-hidden="true">
                      →
                    </span>
                  </div>
                </div>
              )}
              <div
                className="flex min-w-0 flex-1 flex-col justify-center px-5 text-slate-950 first:rounded-l-lg last:rounded-r-lg"
                style={{
                  height: height(index),
                  minWidth: Math.max(130, formatNumber(stage.value).length * 18 + 40),
                  backgroundColor: `color-mix(in srgb, hsl(var(--brand-300)) ${100 - index * 8}%, hsl(var(--brand-500)))`,
                }}
              >
                <p className="text-sm font-semibold">{stage.label}</p>
                <p className="mt-2 font-display text-2xl 2xl:text-3xl font-semibold tracking-tight tabular-nums">
                  {formatNumber(stage.value)}
                </p>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
      <ol className="connected-funnel-vertical" aria-label="Etapas del embudo de conversión">
        {stages.map((stage, index) => (
          <li key={stage.label} className="flex flex-col items-center">
            {index > 0 && (
              <p className="py-2 text-xs font-medium text-muted-foreground tabular-nums">
                <span aria-hidden="true">↓ </span>
                {activityOnly ? '' : formatPercent(stage.conversion, 1)}
              </p>
            )}
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-4 text-slate-950"
              style={{
                width: `${100 - index * 5}%`,
                backgroundColor: `color-mix(in srgb, hsl(var(--brand-300)) ${100 - index * 8}%, hsl(var(--brand-500)))`,
              }}
            >
              <span className="text-sm font-semibold">{stage.label}</span>
              <span className="font-display text-2xl font-semibold tabular-nums">{formatNumber(stage.value)}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        {activityOnly
          ? 'Actividad del periodo; no expresa conversión entre personas.'
          : 'Conversión respecto a la etapa anterior.'}{' '}
        Silueta esquemática, no a escala.
      </p>
    </div>
  )
}
