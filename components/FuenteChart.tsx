'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import {
  PieChart,
  Pie,
  Legend,
} from 'recharts'
import type { SurveyBreakdown } from '@/lib/types'

const PINK_SHADES = [
  '#C9477A',
  '#E8729A',
  '#A33660',
  '#F09AB8',
  '#7A2048',
  '#FFB3CC',
  '#5A1030',
]

interface HorizontalBarChartProps {
  data: SurveyBreakdown[]
  title: string
  loading?: boolean
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
      <div className="text-foreground font-semibold mb-4">{title}</div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-4 w-32" />
            <div
              className="skeleton h-6 rounded"
              style={{ width: `${Math.random() * 60 + 20}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ value: number; payload: SurveyBreakdown }>
}) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload
    return (
      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl p-3 shadow-xl">
        <p className="text-foreground text-sm font-medium">{d.label}</p>
        <p className="text-[#C9477A] text-sm">
          {d.count} leads ({d.pct}%)
        </p>
      </div>
    )
  }
  return null
}

export function HorizontalBarChart({
  data,
  title,
  loading = false,
}: HorizontalBarChartProps) {
  if (loading) return <ChartSkeleton title={title} />
  if (!data || data.length === 0) {
    return (
      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
        <div className="text-foreground font-semibold mb-4">{title}</div>
        <p className="text-[#94a3b8] text-sm">Sin datos aún</p>
      </div>
    )
  }

  // Truncate long labels for display
  const chartData = data.map((d) => ({
    ...d,
    shortLabel:
      d.label.length > 28 ? d.label.slice(0, 26) + '…' : d.label,
  }))

  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6 hover:border-[#C9477A]/20 transition-colors">
      <div className="text-foreground font-semibold mb-5">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
        >
          <XAxis
            type="number"
            hide
            domain={[0, 'dataMax']}
          />
          <YAxis
            type="category"
            dataKey="shortLabel"
            width={170}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(201,71,122,0.05)' }} />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={PINK_SHADES[index % PINK_SHADES.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Value labels */}
      <div className="mt-2 space-y-1">
        {data.slice(0, 3).map((d) => (
          <div key={d.label} className="flex justify-between text-xs">
            <span className="text-[#94a3b8] truncate max-w-[70%]">{d.label}</span>
            <span className="text-[#C9477A] font-medium">
              {d.count} ({d.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface DonutChartProps {
  data: SurveyBreakdown[]
  title: string
  loading?: boolean
}

const CustomPieTooltip = ({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ value: number; name: string; payload: SurveyBreakdown }>
}) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload
    return (
      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl p-3 shadow-xl">
        <p className="text-foreground text-sm font-medium">{d.label}</p>
        <p className="text-[#C9477A] text-sm">
          {d.count} leads ({d.pct}%)
        </p>
      </div>
    )
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderLegend = (props: any) => {
  const payload: Array<{ value: string; color?: string }> = props?.payload || []
  if (!payload.length) return null
  return (
    <div className="flex flex-wrap gap-2 justify-center mt-2">
      {payload.map((entry, index: number) => (
        <div key={index} className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color || '#C9477A' }}
          />
          <span className="max-w-[120px] truncate">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

export function DonutChart({ data, title, loading = false }: DonutChartProps) {
  if (loading) return <ChartSkeleton title={title} />
  if (!data || data.length === 0) {
    return (
      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
        <div className="text-foreground font-semibold mb-4">{title}</div>
        <p className="text-[#94a3b8] text-sm">Sin datos aún</p>
      </div>
    )
  }

  const chartData = data.map((d) => ({ ...d, name: d.label, value: d.count }))

  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6 hover:border-[#C9477A]/20 transition-colors">
      <div className="text-foreground font-semibold mb-4">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="45%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
          >
            {chartData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={PINK_SHADES[index % PINK_SHADES.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomPieTooltip />} />
          <Legend content={renderLegend} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
