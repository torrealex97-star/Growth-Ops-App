'use client'

// Vista del dashboard Meta Ads (Marketing › Campañas). Combina los filtros (funnel, rango,
// cuentas, campañas) con los datos diarios normalizados de Meta y renderiza KPIs, funnel visual,
// tendencia y tablas. TODA métrica: de Meta o calculada solo con datos Meta (§45).

import { useEffect, useMemo, useState } from 'react'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import { aggregateActions, calcMeta, type MetaActionKey, type Metrica } from '@/lib/meta/actions'
import {
  FUNNELS,
  FUNNEL_OPTIONS,
  resolveMetric,
  TODO_UNIVERSAL,
  type FunnelRowByFunnel,
  type MetricDef,
  type SelectableFunnel,
} from '@/lib/meta/funnels'
import {
  DailyTable,
  KpiCard,
  MetaFunnelVisual,
  MetaSourceBadge,
  MetaTrend,
  PerformanceByFunnel,
  CampaignsTable,
  aggregateRows,
  type Aggregated,
  type DailyRow,
} from '@/components/os/MetaAdsDashboard'
import { MetaFunnelAssigner } from '@/components/os/MetaFunnelAssigner'
import { Tags } from 'lucide-react'

type CampaignLite = { id: string; name: string; provider: string | null; account_id: string | null }

const fmtInt = (n: Metrica) => (n == null ? '—' : formatNumber(Math.round(n)))
const fmtEur = (n: Metrica) => (n == null ? '—' : formatCurrency(n))
const fmtX = (n: Metrica) =>
  n == null ? '—' : `${formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`

export function MetaAdsView({
  tenant,
  campaigns,
  rangeFrom,
  rangeTo,
  periodActive,
}: {
  tenant: string
  campaigns: CampaignLite[]
  rangeFrom: string | null
  rangeTo: string | null
  periodActive: boolean
}) {
  // ── Filtro de FUNNEL (§1): cambia KPIs, etapas, columnas y gráficos ─────────
  const [funnel, setFunnel] = useState<SelectableFunnel>('todo')
  const [rows, setRows] = useState<DailyRow[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAssigner, setShowAssigner] = useState(false)

  useEffect(() => {
    if (!periodActive || !rangeFrom || !rangeTo) return
    let active = true
    setCargando(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/meta/daily-actions?from=${rangeFrom}&to=${rangeTo}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Error al cargar datos de Meta')
        if (active) setRows((json.rows ?? []) as DailyRow[])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Error al cargar datos de Meta')
      } finally {
        if (active) setCargando(false)
      }
    })()
    return () => {
      active = false
    }
  }, [tenant, rangeFrom, rangeTo, periodActive])

  // Campañas Meta visibles según la selección de la página (cuenta + multiselect).
  const metaCampaigns = useMemo(() => campaigns.filter((c) => c.provider === 'meta'), [campaigns])
  const byId = useMemo(() => new Map(metaCampaigns.map((c) => [c.id, c])), [metaCampaigns])

  // Asignación funnel por campaña (para el filtro TODO / tablas por funnel).
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/meta/campaign-funnels`)
        const json = await res.json()
        if (active && res.ok) setAsignaciones(json.byCampaign ?? {})
        // byCampaign → { funnel_type, custom_funnel_id } — normalizo al mapa plano.
        if (active && res.ok) {
          const map: Record<string, string> = {}
          for (const [cid, v] of Object.entries(json.byCampaign ?? {})) {
            map[cid] = (v as { funnel_type: string }).funnel_type
          }
          setAsignaciones(map)
        }
      } catch {
        /* sin asignaciones → todo cae en "sin asignar" */
      }
    })()
    return () => {
      active = false
    }
  }, [tenant, showAssigner])

  // Filas de la selección: campaña visible + (fuera de "todo") funnel asignado.
  // Si NINGUNA campaña tiene el funnel asignado, no se filtra: un selector que devuelve siempre
  // vacío no es un filtro, es una pared — con asignaciones el filtro acota, sin ellas se ve todo
  // y el aviso debajo invita a asignar (§2: la clasificación es manual y corregible).
  const filasSeleccion = useMemo(() => {
    const hayAsignadas = funnel === 'todo' || Object.values(asignaciones).some((f) => f === funnel)
    return rows.filter((r) => {
      const c = byId.get(r.campaign_id)
      if (!c) return false
      if (funnel !== 'todo') return !hayAsignadas || asignaciones[r.campaign_id] === funnel
      return true
    })
  }, [rows, byId, funnel, asignaciones])
  const funnelSinAsignar = funnel !== 'todo' && !Object.values(asignaciones).some((f) => f === funnel)

  // ── Agregaciones ────────────────────────────────────────────────────────────
  const totalAgg = useMemo(() => aggregateRows(filasSeleccion), [filasSeleccion])
  const porCampana = useMemo(() => {
    const m = new Map<string, DailyRow[]>()
    for (const r of filasSeleccion) {
      const arr = m.get(r.campaign_id) ?? []
      arr.push(r)
      m.set(r.campaign_id, arr)
    }
    return m
  }, [filasSeleccion])

  const campañasAgg = useMemo(
    () =>
      Array.from(porCampana.entries())
        .map(([id, rs]) => {
          const agg = aggregateRows(rs)
          return agg ? { id, name: byId.get(id)?.name ?? id, agg } : null
        })
        .filter((x): x is { id: string; name: string; agg: Aggregated } => x !== null)
        .sort((a, b) => b.agg.base.spend - a.agg.base.spend),
    [porCampana, byId]
  )

  const porDia = useMemo(() => {
    const m = new Map<string, DailyRow[]>()
    for (const r of filasSeleccion) {
      const arr = m.get(r.date) ?? []
      arr.push(r)
      m.set(r.date, arr)
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rs]) => ({ date, agg: aggregateRows(rs)! }))
  }, [filasSeleccion])

  // ── KPI cards según funnel (§9): gate de tracking — sin dato, sin card ──────
  const config = funnel === 'todo' ? FUNNELS.vsl : FUNNELS[funnel]
  const kpiDefs = funnel === 'todo' ? TODO_UNIVERSAL : config.kpis
  const kpis = useMemo(() => {
    if (!totalAgg) return []
    return kpiDefs
      .map((def) => ({ def, value: resolveMetric(def, totalAgg.calc, totalAgg.base) }))
      .filter((k) => k.value != null)
  }, [kpiDefs, totalAgg])

  // ── Performance by funnel (§26) ─────────────────────────────────────────────
  const byFunnelRows = useMemo<FunnelRowByFunnel[]>(() => {
    if (funnel !== 'todo') return []
    return (['vsl', 'dm', 'webinar'] as const)
      .map((f) => {
        const cfg = FUNNELS[f]
        const filas = rows.filter((r) => asignaciones[r.campaign_id] === f)
        const agg = aggregateRows(filas)
        if (!agg) return null
        const primaryValue = resolveMetric(cfg.primary, agg.calc, agg.base)
        return {
          funnel: cfg.label,
          spend: agg.base.spend || null,
          primary: primaryValue,
          primaryLabel: cfg.primary.label,
          costPrimary: primaryValue != null && agg.base.spend > 0 ? agg.base.spend / primaryValue : null,
          purchases: agg.calc.purchases,
          costPurchase: agg.calc.costPerPurchase,
          roas: agg.calc.roas,
        }
      })
      .filter((x): x is FunnelRowByFunnel => x !== null)
  }, [funnel, rows, asignaciones])

  // ── Tendencia (§30): métricas del funnel, selector día/semana/mes ──────────
  const [granularidad, setGranularidad] = useState<'dia' | 'semana' | 'mes'>('dia')
  const seriesPorGranularidad = useMemo(() => {
    const clave = (d: string) => {
      if (granularidad === 'dia') return d
      if (granularidad === 'semana') {
        const dt = new Date(`${d}T00:00:00Z`)
        dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay())
        return dt.toISOString().slice(0, 10)
      }
      return d.slice(0, 7)
    }
    const m = new Map<string, DailyRow[]>()
    for (const r of filasSeleccion) {
      const k = clave(r.date)
      const arr = m.get(k) ?? []
      arr.push(r)
      m.set(k, arr)
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rs]) => ({ date, agg: aggregateRows(rs)! }))
  }, [filasSeleccion, granularidad])

  const [metricaTrend, setMetricaTrend] = useState<string>('spend')
  const trendDef = useMemo(() => {
    const defs = funnel === 'todo' ? TODO_UNIVERSAL : config.trends
    return defs.find((d) => d.key === metricaTrend) ?? defs[0]
  }, [funnel, config, metricaTrend])

  // ── Vista de comparación de campañas (§32) ──────────────────────────────────
  const comparativa = useMemo(() => {
    if (campañasAgg.length < 2) return null
    const cols: MetricDef[] = funnel === 'todo' ? TODO_UNIVERSAL.slice(0, 6) : config.campaignColumns.slice(0, 8)
    return { cols }
  }, [campañasAgg.length, funnel, config])

  const sinDatos = !cargando && totalAgg === null

  return (
    <div className="space-y-5">
      {/* Barra de filtros del dashboard Meta: FUNNEL + asignación + granularidad */}
      <div className="dashboard-card flex flex-wrap items-center gap-3 p-4">
        <div className="flex gap-1" role="group" aria-label="Tipo de funnel">
          {FUNNEL_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                setFunnel(o.value)
                setMetricaTrend('spend')
              }}
              aria-pressed={funnel === o.value}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                funnel === o.value
                  ? 'bg-brand-500 text-zinc-950'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <MetaSourceBadge />
        <button
          onClick={() => setShowAssigner(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Tags className="h-3.5 w-3.5" /> Configurar funnels
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {funnelSinAsignar && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <span>
            Ninguna campaña tiene asignado el funnel {config.label}: se muestran todas. Asígnalas en «Configurar
            funnels» para acotar el panel a ese embudo.
          </span>
          <button
            onClick={() => setShowAssigner(true)}
            className="rounded-md border border-amber-500/40 px-2 py-1 font-medium hover:bg-amber-500/20"
          >
            Asignar campañas
          </button>
        </div>
      )}

      {/* TODO (§26): universales + performance por funnel */}
      {funnel === 'todo' && byFunnelRows.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Performance por funnel</h3>
          <PerformanceByFunnel rows={byFunnelRows} />
        </div>
      )}

      {/* KPI cards (§9): primero resultado principal, luego tráfico. Sin dato → sin card. */}
      {totalAgg && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.def.key} def={k.def} value={k.value} />
          ))}
        </div>
      )}

      {/* Funnel visual dinámico (§12/§14/§21) */}
      {totalAgg && funnel !== 'todo' && <MetaFunnelVisual config={config} calc={totalAgg.calc} base={totalAgg.base} />}

      {/* Tendencia temporal (§30): selector de métrica + granularidad */}
      {totalAgg && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Tendencia</h3>
            <div className="flex gap-1" role="group" aria-label="Métrica de tendencia">
              {(funnel === 'todo' ? TODO_UNIVERSAL : config.trends).slice(0, 6).map((d) => (
                <button
                  key={d.key}
                  onClick={() => setMetricaTrend(d.key)}
                  aria-pressed={trendDef?.key === d.key}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    trendDef?.key === d.key
                      ? 'bg-brand-500 text-zinc-950'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <div
              className="bg-muted flex rounded-lg border border-border p-0.5"
              role="tablist"
              aria-label="Granularidad"
            >
              {(
                [
                  ['dia', 'Día'],
                  ['semana', 'Semana'],
                  ['mes', 'Mes'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={granularidad === id}
                  onClick={() => setGranularidad(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    granularidad === id ? 'bg-brand-500 text-zinc-950' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {trendDef && <MetaTrend metric={trendDef} rows={seriesPorGranularidad} />}
        </div>
      )}

      {/* Tabla de campañas por funnel (§28) */}
      {totalAgg && (
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Campañas</h3>
          <CampaignsTable config={config} rows={campañasAgg} />
        </div>
      )}

      {/* Tabla diaria (§31): filas diarias con su agregación propia */}
      {totalAgg && (
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Detalle diario</h3>
          <DailyTable
            config={config}
            rows={porDia.map((p) => {
              const filas = filasSeleccion.filter((r) => r.date === p.date)
              return { ...filas[0], date: p.date, agg: p.agg }
            })}
          />
        </div>
      )}

      {sinDatos && !error && (
        <div className="dashboard-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {periodActive
              ? 'Sin datos de Meta en el periodo para esta selección.'
              : 'Elige un periodo para ver el rendimiento de Meta Ads. Los datos vienen de la serie diaria sincronizada.'}
          </p>
        </div>
      )}

      <MetaFunnelAssigner
        tenant={tenant}
        campaigns={metaCampaigns as never}
        open={showAssigner}
        onClose={() => setShowAssigner(false)}
      />
    </div>
  )
}
