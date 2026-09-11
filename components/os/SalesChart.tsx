"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface SalesChartProps {
  data: Array<{ date: string; amount: number }>
  title?: string
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-sm font-semibold text-foreground">
          {formatCurrency(payload[0].value)}
        </p>
      </div>
    )
  }
  return null
}

export function SalesChart({ data, title = 'Cash Cobrado por Día' }: SalesChartProps) {
  return (
    <div className="rounded-2xl border border-[#26262A] bg-[#141416] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_24px_rgba(0,0,0,0.3)]">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">{title}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#71717a' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#71717a' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="amount" fill="#FFFFFF" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
