'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface SalesChartProps {
  data: Array<{ date: string; amount: number }>
  title?: string
  /** Clases extra para la card raíz (p. ej. `h-full` para estirar en una fila de grid). */
  className?: string
  /**
   * Serie opcional de CASH COBRADO por periodo, alineada con `data` (misma fecha/label).
   * Cuando existe, el chart superpone las dos tendencias — FACTURACIÓN (ventas contratadas)
   * vs CASH (dinero realmente cobrado) — para que la distancia entre ambas se vea de un
   * vistazo (data-viz-pro: mismo eje Y, misma unidad €, nunca dual-axis).
   */
  cashData?: Array<{ date: string; cash: number }>
}

type PuntoDual = { date: string; amount: number; cash: number | null }

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; name: string }>
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="dashboard-card p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        {payload.map((p) => (
          <p key={p.dataKey} className="text-sm font-semibold text-foreground">
            {p.name}: {formatCurrency(p.value)}
          </p>
        ))}
      </div>
    )
  }
  return null
}

// Área en vez de barras: comunica mejor evolución/volumen (punto 18) y usa el token de marca del
// tenant (--brand-500, rosa en WDC / azul en Evergreen) en vez de un blanco fijo — antes el chart
// no cambiaba de acento aunque el resto de la UI sí lo hiciera por tenant.
export function SalesChart({ data, title = 'Cash Cobrado por Día', className, cashData }: SalesChartProps) {
  const dual = cashData && cashData.length > 0
  // Fusiona las dos series por periodo para superponerlas en el mismo eje.
  const dataDual: PuntoDual[] = dual
    ? data.map((d) => ({
        date: d.date,
        amount: d.amount,
        cash: cashData!.find((c) => c.date === d.date)?.cash ?? null,
      }))
    : data.map((d) => ({ date: d.date, amount: d.amount, cash: null }))

  return (
    <div className={`dashboard-card p-5 flex flex-col ${className ?? ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {dual && (
          <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full bg-brand-500" />
              Facturación
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full bg-emerald-400" />
              Cash cobrado
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dataDual} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="salesChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--brand-500))" stopOpacity={0.16} />
                <stop offset="100%" stopColor="hsl(var(--brand-500))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="salesChartFillCash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.14} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 6" strokeOpacity={0.45} stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v === 0 ? '' : `${(v / 1000).toFixed(0)}k`)}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--border))' }} />
            {dual && <Legend wrapperStyle={{ display: 'none' }} />}
            <Area
              type="monotone"
              dataKey="amount"
              name="Facturación"
              stroke="hsl(var(--brand-500))"
              strokeWidth={2}
              fill="url(#salesChartFill)"
              isAnimationActive
              animationDuration={400}
            />
            {dual && (
              <Area
                type="monotone"
                dataKey="cash"
                name="Cash cobrado"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#salesChartFillCash)"
                connectNulls
                isAnimationActive
                animationDuration={400}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
