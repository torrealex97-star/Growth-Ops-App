import Link from 'next/link'
import { Megaphone } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

interface MarketingEfficiencyCardProps {
  loading?: boolean
  // null = todavía no hay ninguna campaña con gasto registrado en el periodo (distinto de 0€ real).
  spend: number | null
  revenue: number
  customers: number
}

// "Eficiencia de marketing": agrupa inversión/ingresos/ROAS/CAC del periodo en un único bloque en
// vez de 4 KPICards sueltas — son la misma pregunta de negocio ("¿lo que invertimos en ads está
// funcionando?"), no 4 métricas independientes (punto 26). Usa el gasto DIARIO real de Meta
// (campaign_daily vía /meta/spend-range), no el acumulado histórico de Unit Economics, así que sí
// respeta el filtro de periodo del Dashboard.
export function MarketingEfficiencyCard({ loading, spend, revenue, customers }: MarketingEfficiencyCardProps) {
  const tenant = useTenant()

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (spend === null) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Megaphone className="h-4 w-4" /> Eficiencia de marketing
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Todavía no hay datos de Meta Ads en este periodo. Conecta Meta Ads para medir ROAS y CAC.
        </p>
        <Link
          href={`/${tenant}/settings/integraciones`}
          className="mt-2 inline-block text-xs font-medium text-brand-400 hover:underline"
        >
          Conectar Meta Ads →
        </Link>
      </div>
    )
  }

  const roas = spend > 0 ? revenue / spend : null
  const cac = spend > 0 && customers > 0 ? spend / customers : null

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Megaphone className="h-4 w-4" /> Eficiencia de marketing · periodo
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Inversión en Ads</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatCurrency(spend)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Ingresos (mismo periodo)</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatCurrency(revenue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground" title="Ingresos ÷ inversión en Ads del periodo">
            ROAS
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {roas === null ? '—' : `${roas.toFixed(2)}x`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground" title="Inversión en Ads ÷ clientes únicos del periodo">
            CAC
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {cac === null ? '—' : formatCurrency(cac)}
          </p>
        </div>
      </div>
    </div>
  )
}
