'use client'

// Reparto de un total entre categorías: en qué se va el gasto, de dónde vienen las ventas, cómo se
// distribuyen los estados de cobro.
//
// CUÁNDO USARLO Y CUÁNDO NO. Un pastel responde a "qué peso tiene cada parte DENTRO de un total", y
// solo si las partes suman ese total y son pocas. Para comparar magnitudes entre sí, o para más de
// seis categorías, una barra ordenada se lee mejor y no se usa esto.
//
// · El agujero del centro lleva el TOTAL: es el dato que se busca primero, y así el gráfico responde
//   la pregunta de cabecera sin tener que sumar porciones.
// · Colores de `--serie-1..6`, la paleta categórica validada (ver app/globals.css). En orden fijo y
//   sin ciclar: el color identifica a la categoría, así que filtrar no repinta a las que quedan.
// · A partir de la séptima categoría, el resto se agrupa en "Otros". Un séptimo tono generado
//   dejaría de estar validado y empezaría a confundirse con otro.
// · Leyenda SIEMPRE, con su valor y su porcentaje: la identidad no puede depender solo del color.
// · Las etiquetas van con tokens de texto, nunca con el color de la porción.

import { useMemo, useState } from 'react'
import { formatNumber, formatPercent } from '@/lib/utils'

type ShareSlice = { label: string; value: number }

type Props = {
  data: ShareSlice[]
  /** Qué se está repartiendo, para el centro del donut. */
  totalLabel?: string
  /** Formateador del valor (euros, unidades…). Por defecto, número con separador de miles. */
  format?: (n: number) => string
  /** Máximo de categorías antes de agrupar en "Otros". */
  maxSlices?: number
  className?: string
}

const COLORES = [1, 2, 3, 4, 5, 6].map((i) => `hsl(var(--serie-${i}))`)
const RADIO = 52
const GROSOR = 18
const CIRCUNFERENCIA = 2 * Math.PI * RADIO

export function ShareDonut({ data, totalLabel = 'Total', format, maxSlices = 6, className }: Props) {
  const [activa, setActiva] = useState<string | null>(null)
  const fmt = format ?? ((n: number) => formatNumber(Math.round(n)))

  const { porciones, total } = useMemo(() => {
    const positivas = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
    const total = positivas.reduce((s, d) => s + d.value, 0)
    if (positivas.length <= maxSlices) return { porciones: positivas, total }
    // "Otros" agrupa la cola: mantiene el total correcto sin salirse de la paleta validada.
    const cabeza = positivas.slice(0, maxSlices - 1)
    const resto = positivas.slice(maxSlices - 1).reduce((s, d) => s + d.value, 0)
    return { porciones: [...cabeza, { label: 'Otros', value: resto }], total }
  }, [data, maxSlices])

  if (total <= 0) {
    return (
      <div className={`border-border bg-card rounded-2xl border p-5 ${className ?? ''}`}>
        <p className="text-sm font-medium">{totalLabel}</p>
        {/* Sin datos NO es un pastel vacío ni un 0 disfrazado: se dice. */}
        <p className="text-muted-foreground mt-1 text-sm">Sin datos en el periodo seleccionado.</p>
      </div>
    )
  }

  let acumulado = 0
  const arcos = porciones.map((p, i) => {
    const fraccion = p.value / total
    // 1.5 px de hueco entre porciones: separa los bloques sin que parezcan una porción más.
    const largo = Math.max(0, fraccion * CIRCUNFERENCIA - 1.5)
    const arco = {
      ...p,
      color: COLORES[i % COLORES.length],
      pct: fraccion * 100,
      dash: `${largo} ${CIRCUNFERENCIA - largo}`,
      offset: -acumulado * CIRCUNFERENCIA,
    }
    acumulado += fraccion
    return arco
  })

  const resaltada = arcos.find((a) => a.label === activa)

  return (
    <div className={`border-border bg-card rounded-2xl border p-5 ${className ?? ''}`}>
      <p className="text-sm font-medium">{totalLabel}</p>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={totalLabel}>
          {arcos.map((a) => (
            <circle
              key={a.label}
              cx="60"
              cy="60"
              r={RADIO}
              fill="none"
              stroke={a.color}
              strokeWidth={activa === a.label ? GROSOR + 4 : GROSOR}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              className="donut-arc"
              onMouseEnter={() => setActiva(a.label)}
              onMouseLeave={() => setActiva(null)}
            />
          ))}
        </svg>

        {/* El centro del donut, fuera del SVG rotado para que el texto no gire. */}
        <div className="pointer-events-none -ml-[8.5rem] w-32 text-center">
          <p className="text-foreground text-lg font-semibold tabular-nums">
            {fmt(resaltada ? resaltada.value : total)}
          </p>
          <p className="text-muted-foreground truncate text-xs">{resaltada ? resaltada.label : totalLabel}</p>
        </div>

        {/* Leyenda con valor y porcentaje: la identidad nunca depende solo del color. */}
        <ul className="ml-[8.5rem] min-w-[10rem] flex-1 space-y-1">
          {arcos.map((a) => (
            <li
              key={a.label}
              className={`flex items-center gap-2 text-xs ${activa === a.label ? 'opacity-100' : 'opacity-90'}`}
              onMouseEnter={() => setActiva(a.label)}
              onMouseLeave={() => setActiva(null)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} aria-hidden />
              <span className="text-foreground flex-1 truncate">{a.label}</span>
              <span className="text-muted-foreground tabular-nums">{fmt(a.value)}</span>
              <span className="text-muted-foreground w-10 text-right tabular-nums">
                {formatPercent(a.pct, a.pct < 10 ? 1 : 0)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
