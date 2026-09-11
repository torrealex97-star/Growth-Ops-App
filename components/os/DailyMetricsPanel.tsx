'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { CalendarDays, RefreshCw, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { downloadCSV } from '@/lib/filters/period'
import type { DailyFunnelRow } from '@/lib/ads/funnel'
import { sumDailyRows } from '@/lib/ads/funnel'
import { useTenant } from '@/lib/tenant-context'

const fmtNum = (n: number) => n.toLocaleString('es-ES')
const fmtEur = (n: number | null) => (n === null ? '—' : formatCurrency(n))
const fmtPct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`)

// YYYY-MM-DD → DD/MM (etiqueta corta para los ejes y la tabla).
const shortDate = (d: string) => (d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d)
// Fecha local → YYYY-MM-DD
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

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
            : p.name.toLowerCase().includes('coste')
              ? formatCurrency(p.value ?? 0)
              : (p.value ?? 0).toLocaleString('es-ES')}
        </p>
      ))}
    </div>
  )
}

// Columnas de la tabla en el orden EXACTO pedido por el equipo de ads.
const COLS: { key: keyof DailyFunnelRow; label: string; fmt: (r: DailyFunnelRow) => string; hint?: string }[] = [
  { key: 'inversion', label: 'Inversión', fmt: (r) => fmtEur(r.inversion) },
  { key: 'cpm', label: 'CPM', fmt: (r) => fmtEur(r.cpm) },
  { key: 'impresiones', label: 'Impresiones', fmt: (r) => fmtNum(r.impresiones) },
  { key: 'alcance', label: 'Alcance', fmt: (r) => fmtNum(r.alcance) },
  { key: 'clicsSalientes', label: 'Clics salientes', fmt: (r) => fmtNum(r.clicsSalientes) },
  { key: 'ctr', label: 'CTR', fmt: (r) => fmtPct(r.ctr) },
  { key: 'cpc', label: 'CPC', fmt: (r) => fmtEur(r.cpc) },
  { key: 'visitas', label: 'Visitas a la página', fmt: (r) => fmtNum(r.visitas) },
  { key: 'pctCarga', label: '% Carga', fmt: (r) => fmtPct(r.pctCarga), hint: 'Visitas / clics salientes' },
  { key: 'costeVisita', label: 'Coste por visita', fmt: (r) => fmtEur(r.costeVisita) },
  { key: 'registros', label: 'Registros', fmt: (r) => fmtNum(r.registros) },
  { key: 'costeRegistro', label: 'Coste por registro', fmt: (r) => fmtEur(r.costeRegistro) },
  { key: 'tasaRegistro', label: 'Tasa de registro', fmt: (r) => fmtPct(r.tasaRegistro), hint: 'Registros / visitas' },
  { key: 'agendas', label: 'Agendas', fmt: (r) => fmtNum(r.agendas) },
  { key: 'costeAgenda', label: 'Coste por agenda', fmt: (r) => fmtEur(r.costeAgenda) },
  {
    key: 'tasaConversionVSL',
    label: '% conversión VSL',
    fmt: (r) => fmtPct(r.tasaConversionVSL),
    hint: 'Agendas / registros',
  },
]

// from/to en formato YYYY-MM-DD (del filtro de periodo de la página). Si no hay periodo activo,
// el panel usa por defecto los últimos 30 días.
export function DailyMetricsPanel({ from, to }: { from?: string | null; to?: string | null }) {
  const tenant = useTenant()
  const [rows, setRows] = useState<DailyFunnelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [campaign, setCampaign] = useState('')
  const [campaignInput, setCampaignInput] = useState('')
  const [paidOnly, setPaidOnly] = useState(true)

  // Rango efectivo: el de la página si hay periodo, si no los últimos 30 días.
  const [defFrom, defTo] = useMemo(() => {
    const now = new Date()
    const past = new Date()
    past.setDate(now.getDate() - 29)
    return [ymd(past), ymd(now)]
  }, [])
  const effFrom = from || defFrom
  const effTo = to || defTo

  useEffect(() => {
    let active = true
    setLoading(true)
    const params = new URLSearchParams({ from: effFrom, to: effTo, paidOnly: paidOnly ? '1' : '0' })
    if (campaign) params.set('campaign', campaign)
    ;(async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/meta/daily-funnel?${params.toString()}`)
        const json = await res.json()
        if (active) setRows(res.ok ? (json.rows ?? []) : [])
      } catch {
        if (active) setRows([])
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [effFrom, effTo, campaign, paidOnly])

  const total = useMemo(() => (rows.length ? sumDailyRows(rows) : null), [rows])
  const chartData = useMemo(() => rows.map((r) => ({ ...r, short: shortDate(r.date) })), [rows])

  const exportCSV = () => {
    const headers = ['Fecha', ...COLS.map((c) => c.label)]
    const body = rows.map((r) => [r.date, ...COLS.map((c) => c.fmt(r).replace('—', ''))])
    downloadCSV(`resumen-diario-ads_${effFrom}_a_${effTo}.csv`, headers, body)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-brand-400" /> Resumen diario de métricas
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Del {effFrom} al {effTo} · {paidOnly ? 'agendas de tráfico pago' : 'todas las agendas'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setCampaign(campaignInput.trim())
            }}
            className="flex items-center gap-1"
          >
            <input
              value={campaignInput}
              onChange={(e) => setCampaignInput(e.target.value)}
              placeholder="Contiene campaña (p. ej. VSL)"
              className="text-sm rounded-lg border border-border bg-muted px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500 w-52"
            />
            <button type="submit" className="p-1.5 rounded-md bg-muted text-foreground hover:bg-muted" title="Filtrar">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </form>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={paidOnly}
              onChange={(e) => setPaidOnly(e.target.checked)}
              className="accent-brand-500"
            />
            Solo tráfico pago
          </label>
          <button
            onClick={exportCSV}
            disabled={!rows.length}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs bg-muted text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Tabla por fecha */}
      <div className="bg-card/50 border border-border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="h-48 animate-pulse bg-card" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Sin datos diarios en este rango. Sincroniza el gasto diario de Meta para rellenar la tabla.
          </p>
        ) : (
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground text-[11px] uppercase">
                <th className="px-3 py-2.5 sticky left-0 bg-card/50">Fecha</th>
                {COLS.map((c) => (
                  <th key={c.label} className="px-3 py-2.5 text-right" title={c.hint}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-2 text-foreground sticky left-0 bg-card/50">{r.date}</td>
                  {COLS.map((c) => (
                    <td key={c.label} className="px-3 py-2 text-right text-foreground">
                      {c.fmt(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr className="border-t-2 border-border text-foreground font-semibold bg-card/60">
                  <td className="px-3 py-2.5 sticky left-0 bg-card/60">Total</td>
                  {COLS.map((c) => (
                    <td key={c.label} className="px-3 py-2.5 text-right">
                      {c.fmt(total)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* Gráficos diarios */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* % Registro vs % Conversión VSL (diario) */}
          <div className={chartBox}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">
              Rendimiento diario · % Registro vs % Conversión VSL
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
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
                    dataKey="tasaRegistro"
                    name="% Registro"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="tasaConversionVSL"
                    name="% Conversión VSL"
                    stroke="#ec4899"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Agendas tráfico pago vs Coste por agenda (diario) */}
          <div className={chartBox}>
            <h3 className="text-xs font-medium text-muted-foreground mb-3">
              Rendimiento diario · Agendas (tráfico pago) vs Coste por agenda
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    yAxisId="l"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
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
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
