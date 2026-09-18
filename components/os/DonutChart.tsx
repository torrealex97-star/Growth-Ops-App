'use client'

// DONUT de distribución: qué parte del total aporta cada categoría.
//
// DECISIONES:
// · SVG puro, sin recharts: un donut son 2-4 arcos, no merece un runtime de charts.
// · El acento sale de --brand-500 con opacidades decrecientes (el mismo lenguaje que las áreas
//   de TrendChart), así el donut respeta el color de cada subcuenta.
// · Sin datos no se pinta un donut vacío: se declara "Sin datos en el periodo".

import { formatNumber } from '@/lib/utils'

export type Segmento = { label: string; value: number; color: string }

type Props = {
  title: string
  data: Segmento[]
  /** Formateador del valor (unidades, euros…). Por defecto, número. */
  format?: (n: number) => string
  className?: string
}

const C = 2 * Math.PI * 40 // circunferencia del aro r=40 en el viewBox 100×100

export function DonutChart({ title, data, format, className }: Props) {
  const fmt = format ?? ((n: number) => formatNumber(Math.round(n)))
  const total = data.reduce((a, d) => a + d.value, 0)
  const visibles = data.filter((d) => d.value > 0)

  return (
    <div className={`dashboard-card p-5 ${className ?? ''}`}>
      <p className="text-sm font-medium">{title}</p>
      {total === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">Sin datos en el periodo seleccionado.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <svg viewBox="0 0 100 100" className="-rotate-90 h-28 w-28 shrink-0" role="img" aria-label={title}>
            <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
            {(() => {
              let acumulado = 0
              return visibles.map((d) => {
                const frac = d.value / total
                const seg = (
                  <circle
                    key={d.label}
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke={d.color}
                    strokeWidth="12"
                    strokeDasharray={`${frac * C} ${C}`}
                    strokeDashoffset={-acumulado * C}
                  />
                )
                acumulado += frac
                return seg
              })
            })()}
          </svg>
          <ul className="min-w-40 flex-1 space-y-1.5 text-xs">
            {data.map((d) => (
              <li key={d.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: d.color }} />
                  {d.label}
                </span>
                <span className="text-foreground font-medium tabular-nums">
                  {fmt(d.value)}
                  {d.value > 0 && (
                    <span className="text-muted-foreground font-normal"> · {Math.round((d.value / total) * 100)}%</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
