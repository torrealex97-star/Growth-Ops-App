'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface SalesChartProps {
  data: Array<{ date: string; amount: number }>
  title?: string
  /** Clases extra para la card raíz (p. ej. `h-full` para estirar en una fila de grid). */
  className?: string
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="dashboard-card p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-sm font-semibold text-foreground">{formatCurrency(payload[0].value)}</p>
      </div>
    )
  }
  return null
}

// Área en vez de barras: comunica mejor evolución/volumen (punto 18) y usa el token de marca del
// tenant (--brand-500, rosa en WDC / azul en Evergreen) en vez de un blanco fijo — antes el chart
// no cambiaba de acento aunque el resto de la UI sí lo hiciera por tenant.
export function SalesChart({ data, title = 'Cash Cobrado por Día', className }: SalesChartProps) {
  return (
    <div className={`dashboard-card p-5 flex flex-col ${className ?? ''}`}>
      <h3 className="text-sm font-medium text-muted-foreground mb-4">{title}</h3>
      <div className="flex-1 min-h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="salesChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--brand-500))" stopOpacity={0.16} />
                <stop offset="100%" stopColor="hsl(var(--brand-500))" stopOpacity={0} />
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
            <Area
              type="monotone"
              dataKey="amount"
              stroke="hsl(var(--brand-500))"
              strokeWidth={2}
              fill="url(#salesChartFill)"
              isAnimationActive
              animationDuration={400}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
