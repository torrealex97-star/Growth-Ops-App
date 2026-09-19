'use client'

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCurrency, formatNumber } from '@/lib/utils'

const COLORS = [
  'hsl(var(--brand-500))',
  'hsl(var(--brand-300))',
  'hsl(var(--brand-700))',
  'hsl(var(--brand-200))',
  'hsl(var(--brand-900))',
  'hsl(var(--muted-foreground))',
]
const tooltipStyle = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
}

type Slice = { label: string; amount: number }

// Máximo de porciones del anillo (§ skill data-viz: pie con >5 porciones es anti-patrón):
// top 4 + "Otros" = 5 porciones como tope, agregando por label para no duplicar categorías.
const MAX_RING_SLICES = 5

/** Only parts of the same positive total belong in a ring; signed amounts stay in the legend. */
export function FinanceBreakdown({
  title,
  slices,
  emptyLabel,
}: {
  title: string
  slices: Slice[]
  emptyLabel: string
}) {
  const positive = slices.filter((s) => Number.isFinite(s.amount) && s.amount > 0)
  const total = positive.reduce((sum, s) => sum + s.amount, 0)
  const hasNegative = slices.some((s) => s.amount < 0)
  // Anillo capado: agregado por label (un 'Otros' preexistente se fusiona con el bucket) y top 4.
  const porLabel = new Map<string, number>()
  for (const s of positive) porLabel.set(s.label, (porLabel.get(s.label) ?? 0) + s.amount)
  const ordered = [...porLabel.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
  const ringSlices: Slice[] =
    ordered.length > MAX_RING_SLICES
      ? [
          ...ordered.slice(0, MAX_RING_SLICES - 1),
          { label: 'Otros', amount: ordered.slice(MAX_RING_SLICES - 1).reduce((sum, s) => sum + s.amount, 0) },
        ]
      : ordered
  const restantes = slices.filter((s) => !ringSlices.some((r) => r.label === s.label))
  return (
    <section className="dashboard-card flex h-full flex-col p-5">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mt-3 font-display text-2xl font-semibold tabular-nums tracking-tight">
        {formatCurrency(slices.reduce((sum, s) => sum + s.amount, 0))}
      </p>
      {total === 0 || hasNegative ? (
        <p className="my-auto py-6 text-sm text-muted-foreground">
          {hasNegative ? 'Hay ajustes negativos; consulta el desglose.' : emptyLabel}
        </p>
      ) : (
        <div className="my-3 h-36" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={ringSlices}
                dataKey="amount"
                nameKey="label"
                innerRadius={46}
                outerRadius={65}
                paddingAngle={ringSlices.length > 1 ? 4 : 0}
                cornerRadius={6}
                stroke="none"
                isAnimationActive={false}
              >
                {ringSlices.map((s, i) => (
                  <Cell key={s.label} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <ul className="mt-auto space-y-2">
        {slices.map((s) => {
          const enAnillo = ringSlices.findIndex((r) => r.label === s.label)
          const pct = total > 0 && s.amount > 0 ? Math.round((s.amount / total) * 100) : null
          return (
            <li key={s.label} className="flex items-start justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: enAnillo >= 0 ? COLORS[enAnillo % COLORS.length] : 'hsl(var(--muted-foreground))',
                  }}
                />
                {s.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                {pct != null && <span className="text-muted-foreground">{pct}%</span>}
                {formatCurrency(s.amount)}
              </span>
            </li>
          )
        })}
      </ul>
      {restantes.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          El anillo muestra el top {Math.min(ringSlices.length, MAX_RING_SLICES - 1)} y agrupa el resto como “Otros”; el
          desglose completo está en la lista.
        </p>
      )}
    </section>
  )
}

export function FinanceEvolution({
  data,
}: {
  data: { ym: string; label: string; cash: number; expenses: number; net: number }[]
}) {
  return (
    <section className="dashboard-card p-5">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Evolución de cobros y gastos</h2>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <i className="h-2 w-2 rounded-full bg-brand-500" />
            Cobros
          </span>
          <span className="flex items-center gap-2">
            <i className="h-2 w-2 rounded-full bg-brand-200" />
            Gastos
          </span>
        </div>
      </div>
      <div className="h-72" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={6} margin={{ top: 12, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} strokeDasharray="3 6" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickMargin={12}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={52}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: number) => formatNumber(v, { notation: 'compact' })}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
              formatter={(v) => formatCurrency(Number(v))}
            />
            <Bar
              dataKey="cash"
              name="Cobros"
              fill="hsl(var(--brand-500))"
              radius={[8, 8, 0, 0]}
              maxBarSize={16}
              isAnimationActive={false}
            />
            <Bar
              dataKey="expenses"
              name="Gastos"
              fill="hsl(var(--brand-200))"
              radius={[8, 8, 0, 0]}
              maxBarSize={16}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-5 text-xs">
        <summary className="w-fit cursor-pointer rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Ver importes por mes
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Cobros, gastos y resultado neto de los últimos seis meses</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-2 font-medium" scope="col">
                  Mes
                </th>
                <th className="text-right font-medium" scope="col">
                  Cobros
                </th>
                <th className="text-right font-medium" scope="col">
                  Gastos
                </th>
                <th className="text-right font-medium" scope="col">
                  Neto
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.ym} className="border-t border-border/40">
                  <th scope="row" className="py-2 font-normal">
                    {s.label}
                  </th>
                  <td className="text-right tabular-nums">{formatCurrency(s.cash)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(s.expenses)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(s.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
