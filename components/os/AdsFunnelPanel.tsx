'use client'

import { useMemo } from 'react'
import {
  ComposedChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'
import type { Campaign } from '@/lib/types/database'
import { computeAdFunnel, perCampaign } from '@/lib/ads/funnel'

const fmtNum = (n: number) => n.toLocaleString('es-ES')
const fmtEur = (n: number | null) => (n === null ? '—' : formatCurrency(n))
const fmtPct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`)

// Nombre corto de campaña para los ejes de los gráficos.
const short = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)

type Cell = { label: string; value: string; hint?: string; strong?: boolean }

function MetricGrid({ cells }: { cells: Cell[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {cells.map((c) => (
        <div key={c.label} className="bg-card/50 border border-border rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground leading-tight">{c.label}</p>
          <p className={`mt-1 font-bold text-foreground ${c.strong ? 'text-lg' : 'text-base'}`}>{c.value}</p>
          {c.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{c.hint}</p>}
        </div>
      ))}
    </div>
  )
}

const chartBox = 'bg-card/50 border border-border rounded-lg p-4'

const ChartTooltip = ({ active, payload, label }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {p.name.includes('%') ? `${(p.value ?? 0).toFixed(1)}%` : p.name.toLowerCase().includes('coste') || p.name.toLowerCase().includes('cpl') ? formatCurrency(p.value ?? 0) : (p.value ?? 0).toLocaleString('es-ES')}
        </p>
      ))}
    </div>
  )
}

export function AdsFunnelPanel({ campaigns }: { campaigns: Campaign[] }) {
  const f = useMemo(() => computeAdFunnel(campaigns), [campaigns])
  // Solo campañas con algo de dato para los gráficos (evita ruido de vacías).
  const points = useMemo(
    () => perCampaign(campaigns).filter((p) => p.leads > 0 || p.agendas > 0).map((p) => ({ ...p, short: short(p.name) })),
    [campaigns]
  )

  const cells: Cell[] = [
    { label: 'Inversión', value: fmtEur(f.inversion), strong: true },
    { label: 'Alcance', value: fmtNum(f.alcance) },
    { label: 'Impresiones', value: fmtNum(f.impresiones) },
    { label: 'CPM', value: fmtEur(f.cpm) },
    { label: 'Clics en el enlace', value: fmtNum(f.linkClicks) },
    { label: 'CPC', value: fmtEur(f.cpc) },
    { label: 'CTR', value: fmtPct(f.ctr) },
    { label: 'Visitas a la página', value: fmtNum(f.visitas) },
    { label: 'Coste por visita', value: fmtEur(f.costeVisita) },
    { label: '% de carga', value: fmtPct(f.pctCarga), hint: 'Visitas vs clics' },
    { label: 'Leads', value: fmtNum(f.leads), strong: true },
    { label: 'Coste por lead', value: fmtEur(f.cpl) },
    { label: '% de registro', value: fmtPct(f.pctRegistro), hint: 'Leads vs visitas' },
    { label: 'Agendas', value: fmtNum(f.agendas), strong: true },
    { label: 'Coste por agenda', value: fmtEur(f.costeAgenda) },
    { label: '% conversión VSL', value: fmtPct(f.pctConversionVSL), hint: 'Agendas vs leads' },
    { label: 'Llamadas', value: fmtNum(f.llamadas), hint: 'Show up' },
    { label: '% de show up', value: fmtPct(f.pctShowUp), hint: 'Llamadas vs agendas' },
    { label: 'Cierres', value: fmtNum(f.cierres), strong: true },
    { label: '% de cierre', value: fmtPct(f.pctCierre), hint: 'Cierres vs llamadas' },
    { label: 'CPA', value: fmtEur(f.cpa), strong: true, hint: 'Coste por adquisición' },
    { label: 'Facturación', value: fmtEur(f.facturacion), hint: f.roas !== null ? `ROAS ${f.roas.toFixed(2)}x` : undefined },
    { label: 'Seguidores', value: fmtNum(f.seguidores), strong: true, hint: 'Conseguidos por los ads' },
    { label: 'Coste/seguidor', value: fmtEur(f.costeSeguidor) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Embudo de Ads</h2>
        <span className="text-[11px] text-muted-foreground">Agendas · Llamadas · Cierres se cruzan con el CRM por UTM del contacto</span>
      </div>
      <MetricGrid cells={cells} />

      {points.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Leads vs Coste por Lead */}
          <div className={chartBox}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">Leads vs Coste por Lead</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}€`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(124, 58, 237, 0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="leads" name="Leads" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="r" dataKey="cpl" name="CPL" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
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
                  <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}€`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(16, 185, 129, 0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="agendas" name="Agendas" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="r" dataKey="costeAgenda" name="Coste/Agenda" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
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
                  <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="pctRegistro" name="% Registro" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line dataKey="pctConversionVSL" name="% Conversión VSL" stroke="#ec4899" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
