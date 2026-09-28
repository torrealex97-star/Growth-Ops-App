'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, BarChart3, Info } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '@/lib/utils'
import { KPICard, TargetRow } from '@/components/os/DashboardKPICard'
import type { ComponentProps } from 'react'

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
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-8 space-y-3 border-t border-border/50 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="font-display text-base font-semibold tracking-tight">
            <span className="mr-2 text-brand-500">{number}</span>
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
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
  data: { date: string; value: number | null; comparison?: number | null }[]
  comparisonLabel?: string
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
    <div className="dashboard-card overflow-hidden rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {controls}
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Métrica de ${title}`}>
          {metrics.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === metric.id}
              onClick={() => setSelected(m.id)}
              className={`min-h-9 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${m.id === metric.id ? 'bg-brand-500 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="mt-3 h-44 w-full min-w-0"
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
                <YAxis
                  tickFormatter={(value) => format(Number(value))}
                  width={72}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => axisDate(String(v))}
                  formatter={(v, name) => [
                    format(Number(v)),
                    name === 'comparison'
                      ? metric.comparisonLabel
                      : metric.comparisonLabel
                        ? 'Facturación'
                        : metric.label,
                  ]}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                  }}
                />
                <Bar
                  dataKey="value"
                  fill="hsl(var(--brand-500))"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  isAnimationActive={false}
                />
              </BarChart>
            ) : (
              <AreaChart data={metric.data} margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--brand-500))" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="hsl(var(--brand-500))" stopOpacity={0.01} />
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
                <YAxis
                  tickFormatter={(value) => format(Number(value))}
                  width={72}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => axisDate(String(v))}
                  formatter={(v, name) => [
                    format(Number(v)),
                    name === 'comparison'
                      ? metric.comparisonLabel
                      : metric.comparisonLabel
                        ? 'Facturación'
                        : metric.label,
                  ]}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--brand-500))"
                  strokeWidth={2.5}
                  fill={`url(#${gradientId})`}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {metric.comparisonLabel && (
                  <Area
                    type="monotone"
                    dataKey="comparison"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2}
                    fill="transparent"
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      {metric.comparisonLabel && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="text-brand-500">● Facturación</span> · ○ {metric.comparisonLabel} · mismo eje en €
        </p>
      )}
      {!loading && hasData && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            Ver datos de {metric.label}
          </summary>
          <div className="mt-2 max-h-60 overflow-auto">
            <table className="w-full text-left tabular-nums">
              <caption className="sr-only">
                {title}: {metric.label} en el periodo seleccionado
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="p-2">
                    Periodo
                  </th>
                  <th scope="col" className="p-2 text-right">
                    {metric.comparisonLabel ? 'Facturación' : metric.label}
                  </th>
                  {metric.comparisonLabel && (
                    <th scope="col" className="p-2 text-right">
                      {metric.comparisonLabel}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {metric.data.map((point) => (
                  <tr key={point.date} className="border-b border-border/40">
                    <th scope="row" className="p-2 font-normal">
                      {point.date}
                    </th>
                    <td className="p-2 text-right text-foreground">
                      {point.value === null ? 'Sin dato' : format(point.value)}
                    </td>
                    {metric.comparisonLabel && (
                      <td className="p-2 text-right">
                        {point.comparison == null ? 'Sin dato' : format(point.comparison)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {note && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Sobre estos datos</summary>
          <p className="mt-2">{note}</p>
        </details>
      )}
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
  comparisonLabel?: string
  format?: (value: number) => string
  loading?: boolean
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1)
  return (
    <div className="dashboard-card rounded-xl p-4">
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
                  className="h-2 rounded-full bg-brand-500/80"
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

/** Compact executive metric, scoped to this dashboard instead of changing shared cards. */
export function CompactMetric({
  title,
  value,
  icon: Icon = BarChart3,
  loading,
  description,
  target,
}: ComponentProps<typeof KPICard>) {
  return (
    <div className="dashboard-card flex min-w-0 items-start gap-2.5 rounded-xl p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="text-2xs leading-4 text-muted-foreground">{title}</p>
          {description && (
            <span title={description} tabIndex={0} aria-label={description} className="shrink-0 text-muted-foreground">
              <Info className="h-3 w-3" />
            </span>
          )}
        </div>
        {loading ? (
          <div className="mt-2 h-6 w-16 rounded bg-muted motion-safe:animate-pulse" />
        ) : (
          <p className="mt-1 font-display text-base xl:text-lg font-semibold leading-6 tracking-tight tabular-nums">
            {value}
          </p>
        )}
        {target && <TargetRow target={target} />}
      </div>
    </div>
  )
}

export function AppointmentStatusStrip({
  rows,
  loading,
}: {
  rows: { label: string; value: number }[]
  loading: boolean
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  return (
    <div className="dashboard-card rounded-xl p-4">
      <h3 className="text-sm font-medium">Estado de las citas</h3>
      {loading ? (
        <div className="mt-4 h-8 rounded bg-muted motion-safe:animate-pulse" />
      ) : total === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Sin citas registradas en el periodo.</p>
      ) : (
        <>
          <div
            className="mt-4 flex h-8 overflow-hidden rounded-md"
            role="img"
            aria-label={rows.map((r) => `${r.label}: ${r.value}`).join(', ')}
          >
            {rows.map((r, i) => (
              <div
                key={r.label}
                title={`${r.label}: ${r.value}`}
                className="flex items-center justify-center text-xs font-semibold text-white"
                style={{
                  width: `${(r.value / total) * 100}%`,
                  background: `color-mix(in srgb, hsl(var(--brand-500)) ${Math.max(30, 100 - i * 20)}%, hsl(var(--muted)))`,
                }}
              >
                {r.value / total > 0.08 ? r.value : ''}
              </div>
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {rows.map((r, i) => (
              <li key={r.label} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: `color-mix(in srgb, hsl(var(--brand-500)) ${Math.max(30, 100 - i * 20)}%, hsl(var(--muted)))`,
                  }}
                />
                {r.label} · {r.value}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
