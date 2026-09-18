'use client'

// Dashboard de análisis Meta Ads (Marketing › Campañas). REGLA DE ORO (§45):
// toda métrica viene DIRECTAMENTE de la Insights API de Meta o se calcula SOLO con datos Meta.
// Si Meta no devuelve una métrica para la selección: null → "—" con tooltip explicativo (§7).
// Nada de CRM, Stripe, Typeform, GA4 ni first-party en este panel.

import { useMemo } from 'react'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import { aggregateActions, calcMeta, type BaseMeta, type MetaActionKey, type Metrica } from '@/lib/meta/actions'
import {
  FUNNELS,
  resolveMetric,
  TODO_UNIVERSAL,
  type FunnelConfig,
  type FunnelRowByFunnel,
  type MetricDef,
  type StageDef,
} from '@/lib/meta/funnels'
import type { MetaCalc } from '@/lib/meta/actions'

const fmtEur = (n: Metrica) => (n == null ? '—' : formatCurrency(n))
const fmtInt = (n: Metrica) => (n == null ? '—' : formatNumber(Math.round(n)))
const fmtNum2 = (n: Metrica) =>
  n == null ? '—' : formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n: Metrica) => (n == null ? '—' : formatPercent(n, n != null && Math.abs(n) < 10 ? 1 : 0))
const fmtX = (n: Metrica) =>
  n == null ? '—' : `${formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`

const fmts = { eur: fmtEur, num: fmtNum2, int: fmtInt, pct: fmtPct, x: fmtX } as const

// ── Tooltip CSS puro (§40): qué es, fórmula y origen ─────────────────────────
function MetricHint({ text, calculated }: { text: string; calculated?: boolean }) {
  return (
    <span className="group/hint relative inline-flex cursor-help">
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-muted-foreground/70" fill="currentColor" aria-hidden>
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8.75 12h-1.5V7h1.5v5zm0-6h-1.5V4.5h1.5V6z" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-60 -translate-x-1/2 rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/hint:opacity-100">
        {text}
        <span className="mt-1 block text-muted-foreground">
          {calculated ? 'Calculado usando datos de Meta.' : 'Dato directo de la Meta Marketing API.'}
        </span>
      </span>
    </span>
  )
}

// Badge de origen (§41): pequeño, discreto, con tooltip.
export function MetaSourceBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-[#0866FF]" aria-hidden />
      <span className="group/badge relative cursor-help">
        META
        <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-52 -translate-x-1/2 rounded-lg border border-border bg-popover p-2 text-[11px] normal-case tracking-normal opacity-0 shadow-lg transition-opacity group-hover/badge:opacity-100">
          Fuente: Meta Marketing API. Métricas de Meta o calculadas solo con datos de Meta.
        </span>
      </span>
    </span>
  )
}

// ── Agregación de filas diarias → (base + calc) del rango ───────────────────
export type DailyRow = {
  campaign_id: string
  date: string
  spend: number
  impressions: number
  reach: number
  link_clicks: number
  meta_actions: unknown
  meta_action_values: unknown
}

export type Aggregated = {
  base: { spend: number; impressions: number; reach: number; linkClicks: number }
  calc: MetaCalc
}

export function aggregateRows(rows: DailyRow[]): Aggregated | null {
  if (rows.length === 0) return null
  const actions = aggregateActions(
    rows.map((r) => ({ metaActions: r.meta_actions == null ? null : (r.meta_actions as object) }))
  )
  const actionValues = aggregateActions(
    rows.map((r) => ({ metaActions: r.meta_action_values == null ? null : (r.meta_action_values as object) }))
  )
  const base = {
    spend: rows.reduce((s, r) => s + (Number(r.spend) || 0), 0),
    impressions: rows.reduce((s, r) => s + (Number(r.impressions) || 0), 0),
    reach: rows.reduce((s, r) => s + (Number(r.reach) || 0), 0),
    linkClicks: rows.reduce((s, r) => s + (Number(r.link_clicks) || 0), 0),
  }
  return { base, calc: calcMeta({ ...base, actions, actionValues }) }
}

// ── KPI card (§9/§11/§15/§22): solo con datos; null → la card no se muestra ──
export function KpiCard({ def, value }: { def: MetricDef; value: Metrica }) {
  if (value == null) return null
  return (
    <div className="dashboard-card p-5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {def.label}
        <MetricHint text={def.tooltip} calculated={def.calculated} />
      </p>
      <p className="mt-3 font-display text-3xl tabular-nums font-semibold tracking-tight text-foreground">
        {fmts[def.fmt](value)}
      </p>
    </div>
  )
}

// ── Funnel visual dinámico (§12): cada etapa desaparece si Meta no la devuelve ──
export function MetaFunnelVisual({
  config,
  calc,
  base,
}: {
  config: FunnelConfig
  calc: MetaCalc
  base: Aggregated['base']
}) {
  const stages = useMemo(() => {
    const out: { def: StageDef; value: number }[] = []
    for (const s of config.stages) {
      const v = resolveStage(s, calc, base)
      // El resultado principal del funnel (etapa con dato) siempre entra; las nulas se caen.
      if (v != null) out.push({ def: s, value: v })
    }
    return out
  }, [config, calc, base])

  if (stages.length === 0) {
    return (
      <div className="dashboard-card p-6 text-center text-sm text-muted-foreground">
        Meta no devuelve acciones atribuibles para esta selección todavía.
      </div>
    )
  }

  return (
    <div className="dashboard-card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h3 className="font-display text-lg font-semibold text-foreground">Funnel {config.label}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Solo etapas que Meta atribuye. Cada etapa muestra cantidad, conversión sobre la anterior y coste por unidad.
        </p>
      </div>
      <div className="divide-y divide-border">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1] : null
          const prevVal = prev?.value ?? null
          const rate = prevVal != null && prevVal > 0 ? (s.value / prevVal) * 100 : null
          const cost = base.spend > 0 ? base.spend / s.value : null
          return (
            <div key={s.def.key} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3.5">
              <span className="w-44 text-sm font-medium text-foreground">
                {s.def.label}
                <span className="ml-1.5 align-middle">
                  <MetricHint text={s.def.tooltip} />
                </span>
              </span>
              <span className="min-w-24 text-right font-display text-lg font-semibold tabular-nums text-foreground">
                {fmtInt(s.value)}
              </span>
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                {rate != null ? formatPercent(rate, 1) : ''}
              </span>
              <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">
                {cost != null ? `${fmtEur(cost)} / u.` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function resolveStage(s: StageDef, calc: MetaCalc, base: Aggregated['base']): Metrica {
  if (s.key === 'impressions') return base.impressions
  if (s.key === 'linkClicks') return base.linkClicks
  const map: Partial<Record<MetaActionKey, Metrica>> = {
    landing_page_view: calc.lpv,
    lead: calc.leads,
    schedule: calc.schedules,
    purchase: calc.purchases,
    complete_registration: calc.registrations,
    messaging_conversation_started: calc.conversations,
    post_engagement: calc.engagements,
    view_content: calc.viewContent,
    comment: calc.comments,
    follow: calc.followers,
    profile_visit: calc.profileVisits,
  }
  return map[s.key as MetaActionKey] ?? null
}

// ── Tabla de campañas por funnel (§28): columnas dinámicas, "—" si Meta no lo da ──
export function CampaignsTable({
  config,
  rows,
}: {
  config: FunnelConfig
  rows: { id: string; name: string; agg: Aggregated }[]
}) {
  if (rows.length === 0) {
    return (
      <div className="dashboard-card p-6 text-center text-sm text-muted-foreground">Sin campañas en la selección.</div>
    )
  }
  const cols = config.campaignColumns
  return (
    <div className="dashboard-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-medium sticky left-0 bg-card">Campaña</th>
            {cols.map((c) => (
              <th key={c.key} className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  <MetricHint text={c.tooltip} calculated={c.calculated} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0">
              <td
                className="max-w-56 truncate px-4 py-2.5 text-foreground font-medium sticky left-0 bg-card"
                title={r.name}
              >
                {r.name}
              </td>
              {cols.map((c) => {
                const v = resolveMetric(c, r.agg.calc, r.agg.base)
                return (
                  <td
                    key={c.key}
                    className={`px-4 py-2.5 text-right tabular-nums ${v == null ? 'text-muted-foreground/60' : 'text-foreground'}`}
                  >
                    {fmts[c.fmt](v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tabla diaria por funnel (§31) ────────────────────────────────────────────
export function DailyTable({ config, rows }: { config: FunnelConfig; rows: (DailyRow & { agg: Aggregated })[] }) {
  if (rows.length === 0) {
    return (
      <div className="dashboard-card p-6 text-center text-sm text-muted-foreground">Sin datos diarios en el rango.</div>
    )
  }
  const cols = config.dailyColumns
  return (
    <div className="dashboard-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-medium">Fecha</th>
            {cols.map((c) => (
              <th key={c.key} className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  <MetricHint text={c.tooltip} calculated={c.calculated} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2.5 text-foreground whitespace-nowrap">
                {new Date(`${r.date}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
              </td>
              {cols.map((c) => {
                const v = resolveMetric(c, r.agg.calc, r.agg.base)
                return (
                  <td
                    key={c.key}
                    className={`px-4 py-2.5 text-right tabular-nums ${v == null ? 'text-muted-foreground/60' : 'text-foreground'}`}
                  >
                    {fmts[c.fmt](v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Performance by funnel (§26): sin sumar peras con manzanas ────────────────
export function PerformanceByFunnel({ rows }: { rows: FunnelRowByFunnel[] }) {
  if (rows.length === 0) return null
  const cols = [
    { label: 'Spend', fmt: 'eur' as const },
    { label: 'Primary result', fmt: 'int' as const },
    { label: 'Cost / result', fmt: 'eur' as const },
    { label: 'Purchases', fmt: 'int' as const },
    { label: 'Cost / Purchase', fmt: 'eur' as const },
    { label: 'ROAS', fmt: 'x' as const },
  ]
  return (
    <div className="dashboard-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-medium">Funnel</th>
            {cols.map((c) => (
              <th key={c.label} className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.funnel} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2.5 text-foreground font-medium">{r.funnel}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtEur(r.spend)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                {fmtInt(r.primary)}
                <span className="ml-1.5 text-[10px] text-muted-foreground">{r.primaryLabel}</span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtEur(r.costPrimary)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtInt(r.purchases)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtEur(r.costPurchase)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtX(r.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tendencia temporal (§30): línea, día/semana/mes, métricas del funnel ────
export function MetaTrend({ metric, rows }: { metric: MetricDef; rows: { date: string; agg: Aggregated }[] }) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        date: r.date,
        value: resolveMetric(metric, r.agg.calc, r.agg.base),
      })),
    [rows, metric]
  )
  if (data.length === 0) return null
  return (
    <div className="dashboard-card p-5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {metric.label}
        <MetricHint text={metric.tooltip} calculated={metric.calculated} />
      </p>
      <div className="mt-3 space-y-1">
        {data.slice(-14).map((d) => (
          <div key={d.date} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Date(`${d.date}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
            </span>
            <div className="h-2 flex-1 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-brand-500"
                style={{
                  width: `${Math.min(100, Math.max(2, ((d.value ?? 0) / Math.max(...data.map((x) => x.value ?? 0), 1)) * 100))}%`,
                }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-foreground">
              {fmts[metric.fmt](d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
