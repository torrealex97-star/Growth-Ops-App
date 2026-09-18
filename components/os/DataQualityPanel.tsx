'use client'

// DATA QUALITY + COBERTURA + FUNNEL GLOBAL (§20/§21/§22/§23 de la spec del dashboard global).
// Componente puro de presentación: recibe el diagnóstico calculado con las utilidades puras de
// lib/canonical/dedup + lib/sources/registry y lo pinta con la semántica 0 ≠ "—" (§39).

import { useMemo } from 'react'
import { formatPercent } from '@/lib/utils'
import { coveragePct } from '@/lib/canonical/dedup'
import { SOURCE_REGISTRY } from '@/lib/sources/registry'

export type QualityStats = {
  duplicateLeads: number
  duplicateAppointments: number
  duplicateSales: number
  duplicatePayments: number
  salesWithoutProduct: number
  appointmentsWithoutLead: number
  paymentsWithoutSale: number | null
  unattributedLeads: number
  unattributedSales: number
  totalLeads: number
  totalSales: number
  revenueTotal: number
  revenueAttributed: number
}

export type FunnelGlobal = {
  newUniqueLeads: number
  booked: number
  shows: number
  offers: number
  sales: number
}

const pct = (n: number | null) => (n == null ? '—' : formatPercent(n, 0))

function QualityRow({ label, value, hint, bad }: { label: string; value: number | null; hint: string; bad?: boolean }) {
  const nivel = value == null ? '—' : value === 0 ? '0' : String(value)
  const color =
    value == null ? 'text-muted-foreground' : value === 0 ? 'text-emerald-400' : bad ? 'text-red-400' : 'text-amber-400'
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        {label}
        <span className="ml-1.5 text-[10px]">{hint}</span>
      </span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{nivel}</span>
    </div>
  )
}

// Etiqueta de fuente con tooltip (§37): qué es, fórmula, source of truth y fallbacks.
function SourceHint({ metric }: { metric: string }) {
  const def = SOURCE_REGISTRY[metric]
  if (!def) return null
  const fallbacks = def.fallbacks.length ? def.fallbacks.join(' › ') : 'ninguno'
  const text = `${def.what}\nFórmula: ${def.formula}\nSource of Truth: ${def.primary}. Fallback: ${fallbacks}.`
  return (
    <span className="group/hint relative inline-flex cursor-help align-middle">
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-muted-foreground/70" fill="currentColor" aria-hidden>
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8.75 12h-1.5V7h1.5v5zm0-6h-1.5V4.5h1.5V6z" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-64 -translate-x-1/2 whitespace-pre-line rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/hint:opacity-100">
        {text}
      </span>
    </span>
  )
}

export function DataQualityPanel({ quality, funnel }: { quality: QualityStats; funnel: FunnelGlobal }) {
  // Cobertura (§21): leads / ventas / revenue atribuidos.
  const cobertura = useMemo(
    () => ({
      leads: coveragePct({ total: quality.totalLeads, attributed: quality.totalLeads - quality.unattributedLeads }),
      sales: coveragePct({ total: quality.totalSales, attributed: quality.totalSales - quality.unattributedSales }),
      revenue: quality.revenueTotal > 0 ? Math.round((quality.revenueAttributed / quality.revenueTotal) * 100) : null,
    }),
    [quality]
  )

  // Funnel global (§23): conversiones y drop-off por etapa. Oferta incluida con offer_made cuando
  // exista; si ninguna oferta está registrada, la etapa se muestra sin romper el resto.
  const etapas = useMemo(() => {
    const conTasa = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null)
    return [
      { from: 'Leads', to: 'Agendas', value: funnel.booked, rate: conTasa(funnel.booked, funnel.newUniqueLeads) },
      { from: 'Agendas', to: 'Shows', value: funnel.shows, rate: conTasa(funnel.shows, funnel.booked) },
      { from: 'Shows', to: 'Ofertas', value: funnel.offers, rate: conTasa(funnel.offers, funnel.shows) },
      { from: 'Ofertas', to: 'Ventas', value: funnel.sales, rate: conTasa(funnel.sales, funnel.offers) },
    ]
  }, [funnel])

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* FUNNEL GLOBAL (§22/§23) */}
      <div className="dashboard-card p-5">
        <h3 className="font-display text-lg font-semibold">
          Funnel del negocio
          <span className="ml-2 align-middle">
            <SourceHint metric="lead" />
          </span>
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Entidades canónicas: leads únicos, agendas consolidadas, shows confirmados, ventas sin doble conteo.
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Nuevos leads únicos</span>
            <span className="font-display text-xl font-semibold tabular-nums">{funnel.newUniqueLeads}</span>
          </div>
          {etapas.map((e) => (
            <div key={`${e.from}-${e.to}`}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">
                  → {e.to}{' '}
                  <span className="text-[10px]">
                    {e.from} → {e.to} %
                  </span>
                </span>
                <span className="font-display text-lg font-semibold tabular-nums">{e.value}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-brand-500"
                    style={{ width: `${e.rate != null ? Math.max(2, Math.min(100, e.rate)) : 0}%` }}
                  />
                </div>
                <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(e.rate)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* COBERTURA + CALIDAD (§21/§38) */}
      <div className="space-y-4">
        <div className="dashboard-card p-5">
          <h3 className="font-display text-lg font-semibold">Cobertura de atribución</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Parte del negocio con origen conocido. Baja cobertura = decisiones de presupuesto a ciegas.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            {(
              [
                ['Leads', cobertura.leads],
                ['Ventas', cobertura.sales],
                ['Revenue', cobertura.revenue],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-display text-xl font-semibold tabular-nums">{pct(v)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-card p-5">
          <h3 className="font-display text-lg font-semibold">Calidad de datos</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cero = limpio. Los números ambiguo piden revisión; “—” = no calculable con los datos actuales.
          </p>
          <div className="mt-2 divide-y divide-border/60">
            <QualityRow
              label="Leads duplicados"
              value={quality.duplicateLeads}
              hint="misma persona por email/teléfono"
            />
            <QualityRow
              label="Agendas duplicadas"
              value={quality.duplicateAppointments}
              hint="mismo evento en dos calendarios"
            />
            <QualityRow label="Ventas duplicadas" value={quality.duplicateSales} hint="misma venta en dos sistemas" />
            <QualityRow
              label="Pagos duplicados"
              value={quality.duplicatePayments}
              hint="mismo pago en Stripe y banco"
            />
            <QualityRow label="Ventas sin producto" value={quality.salesWithoutProduct} hint="sin product_id" />
            <QualityRow label="Agendas sin lead" value={quality.appointmentsWithoutLead} hint="sin contact_id" />
            <QualityRow label="Pagos sin venta" value={quality.paymentsWithoutSale} hint="cash sin venta asociada" />
            <QualityRow label="Leads sin atribuir" value={quality.unattributedLeads} hint="sin origen conocido" />
            <QualityRow label="Ventas sin atribuir" value={quality.unattributedSales} hint="sin origen conocido" />
          </div>
        </div>
      </div>
    </div>
  )
}
