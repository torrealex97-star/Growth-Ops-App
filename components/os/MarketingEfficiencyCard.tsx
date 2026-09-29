import Link from 'next/link'
import { Megaphone } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

interface MarketingEfficiencyCardProps {
  loading?: boolean
  // null = todavía no hay ninguna campaña con gasto registrado en el periodo (distinto de 0€ real).
  spend: number | null
  revenue: number
  customers: number
}

// Ratios globales del periodo; no acreditan atribución de ventas a anuncios.
export function MarketingEfficiencyCard({ loading, spend, revenue, customers }: MarketingEfficiencyCardProps) {
  const tenant = useTenant()

  if (loading) {
    return (
      <div className="dashboard-card p-5">
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
          Todavía no hay datos de Meta Ads en este periodo. Conecta Meta Ads para consultar inversión y costes globales.
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

  const revenueToSpend = spend > 0 ? revenue / spend : null
  const cac = spend > 0 && customers > 0 ? spend / customers : null

  return (
    <div className="dashboard-card p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Megaphone className="h-4 w-4" /> Eficiencia de marketing · periodo
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Inversión en Ads</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatCurrency(spend)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Facturación</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatCurrency(revenue)}</p>
        </div>
        <div>
          <p
            className="text-xs text-muted-foreground"
            title="Facturación total ÷ inversión publicitaria del periodo; incluye ventas sin atribución"
          >
            Facturación / inversión
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {revenueToSpend === null
              ? '—'
              : `${formatNumber(revenueToSpend, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground" title="Inversión en Ads ÷ clientes únicos del periodo">
            CAC global
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {cac === null ? '—' : formatCurrency(cac)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Incluye ventas sin atribución; no mide el retorno exclusivo de anuncios.
      </p>
    </div>
  )
}
