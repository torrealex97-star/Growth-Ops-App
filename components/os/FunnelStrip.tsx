import type { FunnelTotals } from '@/lib/analytics'

interface FunnelStripProps {
  totals: FunnelTotals
  loading?: boolean
}

const STEPS: { key: keyof FunnelTotals; label: string; fromLabel?: string; fromKey?: keyof FunnelTotals }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'appointments', label: 'Agendas', fromLabel: 'de leads', fromKey: 'leadToAppt' },
  { key: 'sales', label: 'Ventas', fromLabel: 'de agendas', fromKey: 'apptToSale' },
]

const pct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`

// Funnel del periodo activo (mismo filtro que el resto del Dashboard) — no confundir con el
// embudo detallado de Analítica de ventas, que es acumulado histórico y mide otras etapas
// (demos/llamadas). Aquí solo se representan las 3 etapas que existen con datos fiables: lead
// (contacto creado en el periodo), agenda y venta activa.
export function FunnelStrip({ totals, loading }: FunnelStripProps) {
  if (loading) {
    return (
      <div className="dashboard-card p-5">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (totals.leads === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-5 text-center">
        <p className="text-sm text-muted-foreground">Sin contactos nuevos en este periodo.</p>
      </div>
    )
  }

  return (
    <div className="dashboard-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Funnel del periodo</h3>
        <span className="text-xs text-muted-foreground">
          Lead → Venta <span className="font-semibold text-foreground">{pct(totals.leadToSale)}</span>
        </span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {STEPS.map((step, i) => {
          const value = totals[step.key]
          const ratio = step.fromKey ? totals[step.fromKey] : null
          return (
            <div key={step.key} className="flex flex-1 items-center gap-3">
              <div className="min-w-0 flex-1 rounded-xl bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">{step.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: `${(value / Math.max(totals.leads, totals.appointments, totals.sales, 1)) * 100}%`,
                    }}
                  />
                </div>
                {ratio !== null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pct(ratio)} {step.fromLabel}
                  </p>
                )}
              </div>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="hidden text-muted-foreground sm:block">
                  →
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
