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
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import type { Campaign } from '@/lib/types/database'
import { computeAdFunnel, perCampaign } from '@/lib/ads/funnel'

const fmtNum = (n: number) => formatNumber(n)
const fmtEur = (n: number | null) => (n === null ? '—' : formatCurrency(n))
const fmtPct = (n: number | null) => formatPercent(n, 1)

// Nombre corto de campaña para los ejes de los gráficos.
const short = (name: string) => (name.length > 11 ? `${name.slice(0, 10)}…` : name)

type AlertState = 'ok' | 'warn' | 'bad' | null

// Color de texto según si el KPI cumple el objetivo
// configurado (Settings → Campañas → Objetivos). Sin objetivo fijado, `alert` es null y el
// número se queda en el color normal — nunca inventamos un umbral por defecto, porque "sin
// objetivo" y "objetivo cumplido" no son lo mismo.
const alertText: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
}

// Los mismos KPI canónicos, en tarjetas que se adaptan al ancho disponible.
type HeroStat = { label: string; value: string; hint?: string; alert?: AlertState }

function HeroRow({ stats }: { stats: HeroStat[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="dashboard-card p-5">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p
            className={`mt-3 font-display text-3xl tabular-nums font-semibold tracking-tight ${s.alert ? alertText[s.alert] : 'text-foreground'}`}
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
// `value` es el número CRUDO de la etapa: `count` ya viene formateado para leer, pero para dibujar
// la barra hace falta el número. Sin él esto eran siete filas de texto — una lista de KPIs haciendo
// de embudo, donde la caída entre etapas había que deducirla leyendo cifras.
type FunnelStage = {
  label: string
  count: string
  value: number | null
  cost?: string
  conversion?: string
  alert?: AlertState
}

function FunnelList({ stages }: { stages: FunnelStage[] }) {
  // La cima es el 100 %. Suelo del 6 % para que una etapa con poco volumen siga siendo visible.
  const cima = stages.find((s) => s.value != null && s.value > 0)?.value ?? 0
  const ancho = (v: number | null) => (v == null || !cima ? 100 : Math.max(6, (v / cima) * 100))
  return (
    <div className="funnel-chart divide-border/60 divide-y">
      {stages.map((s, i) => (
        <div key={s.label} className="relative flex items-center gap-3 px-3 py-3 text-sm">
          {/* La barra vive DETRÁS de la fila: el ancho codifica el volumen, así que la reducción
              entre etapas se ve de un vistazo, y las cifras siguen alineadas y legibles. */}
          <span
            className="funnel-bar bg-brand-500/20 pointer-events-none absolute inset-y-1 left-0 rounded-md"
            style={{ width: `${ancho(s.value)}%`, ['--fila' as string]: String(i) }}
            aria-hidden
          />
          <span className="text-muted-foreground relative w-5 text-xs tabular-nums">{i + 1}</span>
          <span className="text-foreground relative flex-1">{s.label}</span>
          {s.conversion && (
            <span className="text-muted-foreground relative w-24 text-right text-xs tabular-nums">{s.conversion}</span>
          )}
          {s.cost && (
            <span
              className={`relative w-20 text-right text-xs tabular-nums ${s.alert ? alertText[s.alert] : 'text-muted-foreground'}`}
            >
              {s.cost}
            </span>
          )}
          <span className="text-foreground relative w-20 text-right font-semibold tabular-nums">{s.count}</span>
        </div>
      ))}
    </div>
  )
}

const chartBox = 'dashboard-card p-5'

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
            ? formatPercent(p.value ?? 0, 1)
            : p.name.toLowerCase().includes('coste') || p.name.toLowerCase().includes('cpl')
              ? formatCurrency(p.value ?? 0)
              : formatNumber(p.value ?? 0)}
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
  // Conservamos todos los puntos y su tooltip, pero limitamos las etiquetas visibles del eje.
  // Con históricos amplios, dibujar un nombre por campaña vuelve el gráfico ilegible.
  const xAxisInterval = Math.max(0, Math.ceil(points.length / 6) - 1)

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
      value: f.roas !== null ? `${formatNumber(f.roas, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '—',
      alert: roasAlert,
      hint: targets?.target_roas
        ? `Objetivo: ≥ ${formatNumber(targets.target_roas, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
        : fmtEur(f.facturacion),
    },
  ]

  const funnelStages: FunnelStage[] = [
    { label: 'Impresiones', count: fmtNum(f.impresiones), value: f.impresiones, cost: fmtEur(f.cpm) + '/mil' },
    {
      label: 'Clics en el enlace',
      count: fmtNum(f.linkClicks),
      value: f.linkClicks,
      cost: fmtEur(f.cpc),
      conversion: fmtPct(f.ctr),
    },
    {
      label: 'Visitas a la página',
      count: fmtNum(f.visitas),
      value: f.visitas,
      cost: fmtEur(f.costeVisita),
      conversion: fmtPct(f.pctCarga),
    },
    {
      label: 'Leads',
      count: fmtNum(f.leads),
      value: f.leads,
      cost: fmtEur(f.cpl),
      conversion: fmtPct(f.pctRegistro),
      alert: cplAlert,
    },
    {
      label: 'Agendas',
      count: fmtNum(f.agendas),
      value: f.agendas,
      cost: fmtEur(f.costeAgenda),
      conversion: fmtPct(f.pctConversionVSL),
    },
    { label: 'Llamadas (show up)', count: fmtNum(f.llamadas), value: f.llamadas, conversion: fmtPct(f.pctShowUp) },
    {
      label: 'Cierres',
      count: fmtNum(f.cierres),
      value: f.cierres,
      cost: fmtEur(f.cpa),
      conversion: fmtPct(f.pctCierre),
      alert: cacAlert,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Embudo de Ads</h2>
        <span className="text-[11px] text-muted-foreground">
          Agendas · Llamadas · Cierres se cruzan con el CRM por UTM del contacto
        </span>
      </div>

      <HeroRow stats={heroStats} />

      <div className="dashboard-ads-funnel dashboard-card p-5 overflow-x-auto">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 px-3">
          <span className="flex-1" />
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Leads vs Coste por Lead */}
          <div className={chartBox}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">Leads vs Coste por Lead</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 6"
                    strokeOpacity={0.4}
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={xAxisInterval}
                    minTickGap={36}
                    tickMargin={10}
                    height={40}
                  />
                  <YAxis
                    yAxisId="l"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="r"
                    orientation="right"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${formatNumber(v)}€`}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--brand-500) / 0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="leads" name="Leads" fill="hsl(var(--brand-500))" radius={[7, 7, 0, 0]} />
                  <Line
                    type="monotone"
                    yAxisId="r"
                    dataKey="cpl"
                    name="CPL"
                    stroke="hsl(var(--brand-300))"
                    strokeWidth={2}
                    dot={points.length < 20 ? { r: 3 } : false}
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
                  <CartesianGrid
                    strokeDasharray="3 6"
                    strokeOpacity={0.4}
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={xAxisInterval}
                    minTickGap={36}
                    tickMargin={10}
                    height={40}
                  />
                  <YAxis
                    yAxisId="l"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="r"
                    orientation="right"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${formatNumber(v)}€`}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(16, 185, 129, 0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="agendas" name="Agendas" fill="#10b981" radius={[7, 7, 0, 0]} />
                  <Line
                    type="monotone"
                    yAxisId="r"
                    dataKey="costeAgenda"
                    name="Coste/Agenda"
                    stroke="hsl(var(--brand-300))"
                    strokeWidth={2}
                    dot={points.length < 20 ? { r: 3 } : false}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* % Registro vs % Conversión VSL */}
          <div className={`${chartBox} xl:col-span-2`}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">% de Registro vs % de Conversión VSL</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 6"
                    strokeOpacity={0.4}
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={xAxisInterval}
                    minTickGap={36}
                    tickMargin={10}
                    height={40}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="pctRegistro"
                    name="% Registro"
                    stroke="hsl(var(--brand-500))"
                    strokeWidth={2}
                    dot={points.length < 20 ? { r: 3 } : false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="pctConversionVSL"
                    name="% Conversión VSL"
                    stroke="hsl(var(--brand-300))"
                    strokeWidth={2}
                    dot={points.length < 20 ? { r: 3 } : false}
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
