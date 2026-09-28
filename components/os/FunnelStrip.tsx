import { ConnectedFunnel } from './ConnectedFunnel'
import type { FunnelTotals } from '@/lib/analytics'

interface FunnelStripProps {
  totals: FunnelTotals
  loading?: boolean
}

const STEPS: { key: keyof FunnelTotals; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'appointments', label: 'Agendas' },
  { key: 'sales', label: 'Ventas' },
]

// Flujos independientes del mismo periodo; no constituyen una cohorte de conversión.
export function FunnelStrip({ totals, loading }: FunnelStripProps) {
  if (loading) {
    return (
      <div className="dashboard-card p-5">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (totals.leads === 0 && totals.appointments === 0 && totals.sales === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-5 text-center">
        <p className="text-sm text-muted-foreground">Sin actividad registrada en este periodo.</p>
      </div>
    )
  }

  return (
    <div className="dashboard-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Actividad del periodo</h3>
      </div>
      <ConnectedFunnel
        activityOnly
        stages={STEPS.map((step) => ({
          label: step.label,
          value: totals[step.key],
        }))}
      />
    </div>
  )
}
