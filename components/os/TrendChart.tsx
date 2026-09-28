'use client'

// Histórico de UNA métrica con su variación: la serie, el valor actual y cuánto ha cambiado frente
// al periodo anterior de la misma duración.
//
// DECISIONES:
// · UN solo eje, siempre. Dos métricas de escala distinta van en dos gráficas, no en dos ejes: un
//   doble eje deja que la forma de las curvas la decida la escala elegida, y con ella la conclusión.
// · Una sola serie ⇒ sin leyenda (el título la nombra) y sin un número sobre cada punto: se etiqueta
//   el último valor y el máximo, que son los que se buscan.
// · El color es `--primary`, el token que lleva el acento de cada subcuenta.
// · La variación se compara contra el periodo INMEDIATAMENTE anterior de la misma duración, que es
//   la única comparación honesta: medio mes contra un mes entero siempre "cae".
// · HUECO ≠ CERO: un día sin dato deja la línea partida en vez de bajar a 0 y fingir una caída.
//   Recharts corta la línea cuando el valor es `null`, y por eso no se rellenan huecos.

import { summarizeTrend } from '@/lib/metrics/trend-summary'
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { formatNumber, formatPercent } from '@/lib/utils'

type TrendPoint = { date: string; value: number | null }

/** Una nota del equipo anclada a una fecha (tabla `annotations`), para marcar el porqué de un pico. */
export type TrendAnnotation = { date: string; title: string }

type Props = {
  title: string
  data: TrendPoint[]
  /** Formateador del valor (euros, unidades…). */
  format?: (n: number) => string
  /** Valor del periodo anterior, para la variación. Si falta, no se muestra comparación. */
  previousTotal?: number | null
  /** 'sum' para acumulables (ventas, gasto); 'last' para stocks (nº de alumnas). */
  aggregate?: 'sum' | 'last'
  /** Marcas verticales del equipo (campaña, incidencia…) dentro del rango de `data`. */
  annotations?: TrendAnnotation[]
  className?: string
}

const fmtFecha = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export function TrendChart({ title, data, format, previousTotal, aggregate = 'sum', annotations, className }: Props) {
  const fmt = format ?? ((n: number) => formatNumber(Math.round(n)))

  const { actual, anterior, conDato } = useMemo(() => {
    const conDato = data.filter((d) => d.value != null)
    const summary = summarizeTrend(data, aggregate, previousTotal)
    return { actual: summary.total ?? 0, anterior: summary.previous, conDato }
  }, [data, previousTotal, aggregate])

  // Solo se pintan las que caen dentro del rango de la serie: una fuera de rango no tiene un punto
  // del eje X al que anclarse y Recharts la ignoraría en silencio.
  const marcas = useMemo(() => {
    if (!annotations?.length) return []
    const fechas = new Set(data.map((d) => d.date))
    return annotations.filter((a) => fechas.has(a.date))
  }, [annotations, data])

  // Sin base no hay porcentaje: de 0 a 5 no es "+500 %", es "antes no había nada".
  const variacion = anterior != null && anterior !== 0 ? ((actual - anterior) / Math.abs(anterior)) * 100 : null
  const Flecha =
    variacion == null ? ArrowRight : variacion > 0 ? ArrowUpRight : variacion < 0 ? ArrowDownRight : ArrowRight
  const colorVar = 'text-muted-foreground'

  if (conDato.length === 0) {
    return (
      <div className={`dashboard-card p-5 ${className ?? ''}`}>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">Sin datos en el periodo seleccionado.</p>
      </div>
    )
  }

  return (
    <div className={`dashboard-card p-5 ${className ?? ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-foreground text-lg font-semibold tabular-nums">{fmt(actual)}</span>
          {variacion != null ? (
            <span className={`flex items-center gap-0.5 text-xs tabular-nums ${colorVar}`}>
              <Flecha className="h-3.5 w-3.5" aria-hidden />
              {formatPercent(Math.abs(variacion), Math.abs(variacion) < 10 ? 1 : 0)}
            </span>
          ) : (
            // Se dice por qué no hay comparación, en vez de pintar un 0 % que parece "no cambió".
            <span className="text-muted-foreground text-xs">sin periodo anterior con el que comparar</span>
          )}
        </div>
      </div>

      <div className="mt-3 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`trend-${title.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.16} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {/* Rejilla recesiva: orienta sin competir con la serie. */}
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtFecha}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={84}
              // El "0" en el origen es ruido: lo marca la geometría, no el eje.
              tickFormatter={(v) => (v === 0 ? '' : fmt(Number(v)))}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(l) => fmtFecha(String(l))}
              formatter={(v) => [fmt(Number(v)), title]}
            />
            {marcas.map((m) => (
              <ReferenceLine
                key={m.date + m.title}
                x={m.date}
                stroke="hsl(var(--brand-500) / 0.6)"
                strokeDasharray="3 3"
                label={{
                  value: m.title,
                  position: 'insideTopRight',
                  fontSize: 10,
                  fill: 'hsl(var(--brand-500))',
                }}
              />
            ))}
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill={`url(#trend-${title.replace(/\W/g, '')})`}
              // Sin puntos por defecto (serían un número por día); el activo aparece al pasar por encima.
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              // connectNulls a false A PROPÓSITO: un día sin dato parte la línea en vez de inventar
              // una interpolación que se lee como si hubiera medición.
              isAnimationActive={false}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
