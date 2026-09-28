'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '@/lib/utils'

export function DepartmentSection({
  id,
  number,
  title,
  description,
  href,
  children,
}: {
  id: string
  number: string
  title: string
  description: string
  href: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-8 space-y-4 border-t border-border/50 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="font-display text-xl font-semibold tracking-tight">
            <span className="mr-3 text-primary">{number}</span>
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Ver detalle <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      {children}
    </section>
  )
}

type Metric = {
  id: string
  label: string
  data: { date: string; value: number | null }[]
  format?: (value: number) => string
}
export function MetricExplorer({
  title,
  metrics,
  controls,
  loading = false,
  bars = false,
  note,
}: {
  title: string
  metrics: Metric[]
  controls?: ReactNode
  loading?: boolean
  bars?: boolean
  note?: string
}) {
  const [selected, setSelected] = useState(metrics[0]?.id)
  const metric = metrics.find((m) => m.id === selected) ?? metrics[0]
  const gradientId = useId().replace(/:/g, '')
  if (!metric) return null
  const format = metric.format ?? ((n: number) => formatNumber(n))
  const hasData = metric.data.some((p) => p.value !== null)
  const axisDate = (s: string) =>
    s.length === 7 ? s.split('-').reverse().join('/') : s.slice(5).split('-').reverse().join('/')
  return (
    <div className="dashboard-card overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {controls}
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={`Métrica de ${title}`}>
        {metrics.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={m.id === metric.id}
            onClick={() => setSelected(m.id)}
            className={`min-h-10 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${m.id === metric.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div
        className="mt-5 h-64 w-full min-w-0"
        role="img"
        aria-label={`${metric.label}: evolución del periodo seleccionado`}
      >
        {loading ? (
          <div className="h-full rounded-xl bg-muted motion-safe:animate-pulse" />
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sin registros para esta métrica en el periodo.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {bars ? (
              <BarChart data={metric.data} margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
                <XAxis
                  dataKey="date"
                  tickFormatter={axisDate}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis tickFormatter={format} width={72} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(v) => axisDate(String(v))}
                  formatter={(v) => [format(Number(v)), metric.label]}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                  }}
                />
                <Bar
                  dataKey="value"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  isAnimationActive={false}
                />
              </BarChart>
            ) : (
              <AreaChart data={metric.data} margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
                <XAxis
                  dataKey="date"
                  tickFormatter={axisDate}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis tickFormatter={format} width={72} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(v) => axisDate(String(v))}
                  formatter={(v) => [format(Number(v)), metric.label]}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  fill={`url(#${gradientId})`}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      {note && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  )
}

export function BreakdownBars({
  title,
  rows,
  format = formatNumber,
  loading = false,
}: {
  title: string
  rows: { label: string; value: number }[]
  format?: (value: number) => string
  loading?: boolean
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1)
  return (
    <div className="dashboard-card rounded-2xl p-5 sm:p-6">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {loading ? (
        <div className="mt-5 h-32 rounded-xl bg-muted motion-safe:animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">Sin desglose disponible en el periodo.</p>
      ) : (
        <dl className="mt-6 space-y-5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="mb-2 flex justify-between gap-4 text-sm">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-semibold tabular-nums">{format(r.value)}</dd>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary/80"
                  style={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
