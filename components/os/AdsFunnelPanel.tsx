'use client'

import { useMemo } from 'react'
import {
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'
import type { Campaign } from '@/lib/types/database'
import { computeAdFunnel, perCampaign } from '@/lib/ads/funnel'

const fmtNum = (n: number) => n.toLocaleString('es-ES')
const fmtEur = (n: number | null) => (n === null ? '—' : formatCurrency(n))
const fmtPct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`)

// Nombre corto de campaña para los ejes de los gráficos.
const short = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)

type AlertState = 'ok' | 'warn' | 'bad' | null

// Color de texto (no de tarjeta — aquí no hay tarjetas) según si el KPI cumple el objetivo
// configurado (Settings → Campañas → Objetivos). Sin objetivo fijado, `alert` es null y el
// número se queda en el color normal — nunca inventamos un umbral por defecto, porque "sin
// objetivo" y "objetivo cumplido" no son lo mismo.
const alertText: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
}

// KPI grande, "hero": los 4-5 números que de verdad importan de un vistazo, sin tarjeta propia
// — una sola superficie con divisores en vez de un grid de cards idénticas.
type HeroStat = { label: string; value: string; hint?: string; alert?: AlertState }

function HeroRow({ stats }: { stats: HeroStat[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
      {stats.map((s) => (
        <div key={s.label} className="px-4 py-3 first:pl-0 sm:first:pl-0">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p
            className={`mt-1 text-2xl font-semibold tracking-tight ${s.alert ? alertText[s.alert] : 'text-foreground'}`}
          >
            {s.value}
          </p>
          {s.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</p>}
        </div>
      ))}
    </div>
  )
}

// Una etapa del funnel: cantidad + coste por unidad + conversión respecto a la etapa anterior
// (drop-off implícito: 100% - conversión). Fila de texto, no card — el funnel se lee de arriba
// abajo como un embudo real, no como cifras sueltas.
type FunnelStage = { label: string; count: string; cost?: string; conversion?: string; alert?: AlertState }

function FunnelList({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="divide-y divide-border/60">
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center gap-3 py-2.5 text-sm">
          <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
          <span className="flex-1 text-foreground">{s.label}</span>
          {s.conversion && (
            <span className="text-xs text-muted-foreground w-24 text-right tabular-nums">{s.conversion}</span>
          )}
          {s.cost && (
            <span
              className={`text-xs w-20 text-right tabular-nums ${s.alert ? alertText[s.alert] : 'text-muted-foreground'}`}
            >
              {s.cost}
            </span>
          )}
          <span className="font-semibold text-foreground w-20 text-right tabular-nums">{s.count}</span>
        </div>
      ))}
    </div>
  )
}

const chartBox = 'bg-card/50 border border-border rounded-lg p-4'

const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}:{' '}
          {p.name.includes('%')
            ? `${(p.value ?? 0).toFixed(1)}%`
            : p.name.toLowerCase().includes('coste') || p.name.toLowerCase().includes('cpl')
              ? formatCurrency(p.value ?? 0)
              : (p.value ?? 0).toLocaleString('es-ES')}
        </p>
      ))}
    </div>
  )
}

export type CampaignTargets = {
  target_roas: number | null
  target_cac: number | null
  target_cpl: number | null
}

// bad si se aleja del objetivo por más de un 20%, warn si lo incumple pero por poco.
function targetAlert(value: number | null, target: number | null, direction: 'min' | 'max'): AlertState {
  if (value === null || target === null || target <= 0) return null
  const ok = direction === 'min' ? value >= target : value <= target
  if (ok) return 'ok'
  const deviation = direction === 'min' ? (target - value) / target : (value - target) / target
  return deviation > 0.2 ? 'bad' : 'warn'
}

export function AdsFunnelPanel({ campaigns, targets }: { campaigns: Campaign[]; targets?: CampaignTargets | null }) {
  const f = useMemo(() => computeAdFunnel(campaigns), [campaigns])
  // Solo campañas con algo de dato para los gráficos (evita ruido de vacías).
  const points = useMemo(
    () =>
      perCampaign(campaigns)
        .filter((p) => p.leads > 0 || p.agendas > 0)
        .map((p) => ({ ...p, short: short(p.name) })),
    [campaigns]
  )

  const cplAlert = targetAlert(f.cpl, targets?.target_cpl ?? null, 'max')
  const cacAlert = targetAlert(f.cpa, targets?.target_cac ?? null, 'max')
  const roasAlert = targetAlert(f.roas, targets?.target_roas ?? null, 'min')

  const heroStats: HeroStat[] = [
    { label: 'Inversión', value: fmtEur(f.inversion) },
    { label: 'Leads', value: fmtNum(f.leads) },
    {
      label: 'Coste por lead',
      value: fmtEur(f.cpl),
      alert: cplAlert,
      hint: targets?.target_cpl ? `Objetivo: ≤ ${fmtEur(targets.target_cpl)}` : undefined,
    },
    {
      label: 'ROAS',
      value: f.roas !== null ? `${f.roas.toFixed(2)}x` : '—',
      alert: roasAlert,
      hint: targets?.target_roas ? `Objetivo: ≥ ${targets.target_roas.toFixed(2)}x` : fmtEur(f.facturacion),
    },
  ]

  const funnelStages: FunnelStage[] = [
    { label: 'Impresiones', count: fmtNum(f.impresiones), cost: fmtEur(f.cpm) + '/mil' },
    { label: 'Clics en el enlace', count: fmtNum(f.linkClicks), cost: fmtEur(f.cpc), conversion: fmtPct(f.ctr) },
    {
      label: 'Visitas a la página',
      count: fmtNum(f.visitas),
      cost: fmtEur(f.costeVisita),
      conversion: fmtPct(f.pctCarga),
    },
    {
      label: 'Leads',
      count: fmtNum(f.leads),
      cost: fmtEur(f.cpl),
      conversion: fmtPct(f.pctRegistro),
      alert: cplAlert,
    },
    {
      label: 'Agendas',
      count: fmtNum(f.agendas),
      cost: fmtEur(f.costeAgenda),
      conversion: fmtPct(f.pctConversionVSL),
    },
    { label: 'Llamadas (show up)', count: fmtNum(f.llamadas), conversion: fmtPct(f.pctShowUp) },
    {
      label: 'Cierres',
      count: fmtNum(f.cierres),
      cost: fmtEur(f.cpa),
      conversion: fmtPct(f.pctCierre),
      alert: cacAlert,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Embudo de Ads</h2>
        <span className="text-[11px] text-muted-foreground">
          Agendas · Llamadas · Cierres se cruzan con el CRM por UTM del contacto
        </span>
      </div>

      <HeroRow stats={heroStats} />

      <div className="rounded-lg border border-border bg-card/30 p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 pl-8">
          <span />
          <span className="w-24 text-right">% conversión</span>
          <span className="w-20 text-right">Coste/ud.</span>
          <span className="w-20 text-right">Cantidad</span>
        </div>
        <FunnelList stages={funnelStages} />
        {f.seguidores > 0 && (
          <div className="flex items-center gap-3 pt-2.5 mt-1 border-t border-border/60 text-sm text-muted-foreground">
            <span className="w-5" />
            <span className="flex-1">Seguidores conseguidos</span>
            <span className="text-xs w-24 text-right" />
            <span className="text-xs w-20 text-right tabular-nums">{fmtEur(f.costeSeguidor)}</span>
            <span className="font-medium text-foreground w-20 text-right tabular-nums">{fmtNum(f.seguidores)}</span>
          </div>
        )}
      </div>

      {points.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Leads vs Coste por Lead */}
          <div className={chartBox}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">Leads vs Coste por Lead</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis
                    yAxisId="r"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}€`}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(124, 58, 237, 0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="leads" name="Leads" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                  <Line
                    yAxisId="r"
                    dataKey="cpl"
                    name="CPL"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Agendas vs Coste por Agenda */}
          <div className={chartBox}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">Agendas vs Coste por Agenda</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis
                    yAxisId="r"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}€`}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(16, 185, 129, 0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="agendas" name="Agendas" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Line
                    yAxisId="r"
                    dataKey="costeAgenda"
                    name="Coste/Agenda"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* % Registro vs % Conversión VSL */}
          <div className={`${chartBox} lg:col-span-2`}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">% de Registro vs % de Conversión VSL</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    dataKey="pctRegistro"
                    name="% Registro"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    dataKey="pctConversionVSL"
                    name="% Conversión VSL"
                    stroke="#ec4899"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
