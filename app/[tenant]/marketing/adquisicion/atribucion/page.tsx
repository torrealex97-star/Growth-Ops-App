'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Megaphone, Users, Calendar, ShoppingCart, TrendingUp, ArrowLeftRight, Target, Layers, ClipboardList, Globe } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { KPICard } from '@/components/os/DashboardKPICard'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, type PeriodPreset } from '@/lib/filters/period'
import { isPaidSource } from '@/lib/ads/funnel'
import { QUALIFICATION_KEYS, labelFor, type QualificationAnswer } from '@/lib/qualification'
import { countryISOForPhone, countryNameForISO } from '@/lib/phone'
import { useTenant } from '@/lib/tenant-context'
import { normalizeText } from '@/components/ui/search-box'

type FunnelRow = { source: string; leads: number; appointments: number; sales: number; gross: number }

type UtmTouchRow = {
  contact_id: string
  contact_name: string
  phone: string | null
  source: string | null
  first_utm_source: string | null
  first_utm_campaign: string | null
  last_utm_source: string | null
  last_utm_campaign: string | null
  first_touch_at: string | null
  last_touch_at: string | null
}

type AppointmentRow = {
  id: string
  source: string | null
  utm_source: string | null
  utm_campaign: string | null
  appointment_datetime: string | null
}

type LeadQualityRow = {
  contact_id: string
  contact_name: string
  source: string | null
  campaign: string | null
  updated_at: string | null
  answers: Record<string, string>
  respuestas: QualificationAnswer[]
}

type BarItem = { label: string; count: number }

const NO_UTM = 'Directo/Sin UTM'

// Fecha local → YYYY-MM-DD (para los límites de la consulta, sin desfase de zona).
const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function buildBars(map: Map<string, number>, limit = 10): { bars: BarItem[]; total: number } {
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0)
  const bars = Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
  return { bars, total }
}

function BarList({
  bars,
  total,
  color,
  loading,
  emptyLabel = 'Sin datos.',
}: {
  bars: BarItem[]
  total: number
  color: 'violet' | 'emerald' | 'cyan'
  loading?: boolean
  emptyLabel?: string
}) {
  const colorMap = {
    violet: 'bg-brand-500',
    emerald: 'bg-emerald-500',
    cyan: 'bg-cyan-500',
  }
  const textMap = {
    violet: 'text-brand-400',
    emerald: 'text-emerald-400',
    cyan: 'text-cyan-400',
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-6 animate-pulse bg-muted rounded" />
        ))}
      </div>
    )
  }

  if (bars.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{emptyLabel}</p>
  }

  const max = Math.max(...bars.map((b) => b.count), 1)

  return (
    <div className="space-y-3">
      {bars.map((b) => {
        const widthPct = (b.count / max) * 100
        const sharePct = total ? (b.count / total) * 100 : 0
        return (
          <div key={b.label}>
            <div className="flex items-center justify-between text-sm mb-1 gap-3">
              <span className="text-foreground truncate">{b.label}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                <span className={`font-semibold ${textMap[color]}`}>{b.count}</span>
                <span className="text-muted-foreground text-xs ml-1">({sharePct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${colorMap[color]} rounded-full transition-all`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function AttributionPage() {
  const tenant = useTenant()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<FunnelRow[]>([])
  const [loadingTouch, setLoadingTouch] = useState(true)
  const [touchRows, setTouchRows] = useState<UtmTouchRow[]>([])
  const [loadingAppts, setLoadingAppts] = useState(true)
  const [apptRows, setApptRows] = useState<AppointmentRow[]>([])
  const [loadingQual, setLoadingQual] = useState(true)
  const [qualRows, setQualRows] = useState<LeadQualityRow[]>([])
  const [qualSource, setQualSource] = useState('all')
  const [qualSearch, setQualSearch] = useState('')

  // Filtros de la sección de agendas (pedido por el equipo de ads).
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  const range = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )
  const rangeFrom = useMemo(() => (range.from ? ymdLocal(range.from) : null), [range.from])
  const rangeTo = useMemo(() => (range.to ? ymdLocal(range.to) : null), [range.to])

  // Funnel por fuente (RPC) + first/last touch — globales, se cargan una vez.
  useEffect(() => {
    let mounted = true
    async function loadGlobal() {
      const supabase = createClient()
      const [funnelRes, touchRes] = await Promise.all([
        supabase.rpc('attribution_funnel'),
        supabase
          .from('contact_attributions')
          .select(
            'contact_id, source, first_utm_source, first_utm_campaign, last_utm_source, last_utm_campaign, first_touch_at, last_touch_at, contacts(full_name, phone)'
          )
          .order('last_touch_at', { ascending: false })
          .limit(300),
      ])
      if (!mounted) return
      setRows(
        (funnelRes.data || []).map(
          (r: { source: string; leads: number; appointments: number; sales: number; gross: number }) => ({
            source: r.source,
            leads: Number(r.leads),
            appointments: Number(r.appointments),
            sales: Number(r.sales),
            gross: Number(r.gross),
          })
        )
      )
      setLoading(false)
      setTouchRows(
        (touchRes.data || []).map((r: any) => ({
          contact_id: r.contact_id,
          contact_name: r.contacts?.full_name || '—',
          phone: r.contacts?.phone || null,
          source: r.source,
          first_utm_source: r.first_utm_source,
          first_utm_campaign: r.first_utm_campaign,
          last_utm_source: r.last_utm_source,
          last_utm_campaign: r.last_utm_campaign,
          first_touch_at: r.first_touch_at,
          last_touch_at: r.last_touch_at,
        }))
      )
      setLoadingTouch(false)
    }
    loadGlobal()
    return () => { mounted = false }
  }, [])

  // Agendas — se recargan cuando cambia el rango de fechas (el filtro de campaña/fuente
  // se aplica en cliente sobre lo cargado).
  useEffect(() => {
    let mounted = true
    async function loadAppts() {
      setLoadingAppts(true)
      const supabase = createClient()
      let q = supabase
        .from('appointments')
        .select('id, source, utm_source, utm_campaign, appointment_datetime')
        .order('appointment_datetime', { ascending: false })
      if (rangeFrom) q = q.gte('appointment_datetime', `${rangeFrom}T00:00:00`)
      if (rangeTo) q = q.lte('appointment_datetime', `${rangeTo}T23:59:59`)
      const { data } = await q.limit(5000)
      if (!mounted) return
      setApptRows(
        (data || []).map((r: any) => ({
          id: r.id,
          source: r.source,
          utm_source: r.utm_source,
          utm_campaign: r.utm_campaign,
          appointment_datetime: r.appointment_datetime,
        }))
      )
      setLoadingAppts(false)
    }
    loadAppts()
    return () => { mounted = false }
  }, [rangeFrom, rangeTo])

  // Calidad de leads — respuestas del formulario por contacto (con su fuente primaria).
  useEffect(() => {
    let mounted = true
    async function loadQual() {
      const supabase = createClient()
      const { data } = await supabase
        .from('contacts')
        .select('id, full_name, qualification, qualification_updated_at, contact_attributions(source, utm_campaign, is_primary)')
        .not('qualification', 'is', null)
        .order('qualification_updated_at', { ascending: false })
        .limit(500)
      if (!mounted) return
      setQualRows(
        (data || []).map((r: any) => {
          const q = r.qualification || {}
          const answers: Record<string, string> = {}
          for (const k of QUALIFICATION_KEYS) {
            const v = q[k]
            if (typeof v === 'string' && v.trim()) answers[k] = v.trim()
          }
          const attrs = Array.isArray(r.contact_attributions) ? r.contact_attributions : []
          const primary = attrs.find((a: any) => a.is_primary) || attrs[0] || null
          return {
            contact_id: r.id,
            contact_name: r.full_name || '—',
            source: primary?.source || null,
            campaign: primary?.utm_campaign || null,
            updated_at: r.qualification_updated_at,
            answers,
            respuestas: Array.isArray(q.respuestas) ? q.respuestas : [],
          }
        })
      )
      setLoadingQual(false)
    }
    loadQual()
    return () => { mounted = false }
  }, [])

  const qualSources = useMemo(
    () => Array.from(new Set(qualRows.map((r) => r.source || NO_UTM))).sort(),
    [qualRows]
  )
  const filteredQual = useMemo(
    () =>
      qualRows.filter((r) => {
        if (qualSource !== 'all' && (r.source || NO_UTM) !== qualSource) return false
        if (qualSearch.trim()) {
          const s = normalizeText(qualSearch.trim())
          const hay = normalizeText(r.contact_name + ' ' + r.respuestas.map((x) => x.a).join(' '))
          if (!hay.includes(s)) return false
        }
        return true
      }),
    [qualRows, qualSource, qualSearch]
  )

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          leads: a.leads + r.leads,
          appts: a.appts + r.appointments,
          sales: a.sales + r.sales,
          gross: a.gross + r.gross,
        }),
        { leads: 0, appts: 0, sales: 0, gross: 0 }
      ),
    [rows]
  )

  const { bars: firstCampaignBars, total: firstCampaignTotal } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of touchRows) {
      const key = (r.first_utm_campaign || '').trim()
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return buildBars(counts, 10)
  }, [touchRows])

  const { bars: lastCampaignBars, total: lastCampaignTotal } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of touchRows) {
      const key = (r.last_utm_campaign || '').trim()
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return buildBars(counts, 10)
  }, [touchRows])

  const { bars: sourceBars, total: sourceTotal } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of touchRows) {
      const key = (r.source || r.first_utm_source || '').trim() || NO_UTM
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return buildBars(counts, 10)
  }, [touchRows])

  // País por prefijo del teléfono. Los leads sin prefijo detectable (número sin "+"/"00") van a
  // "Sin prefijo" en vez de asumir España, para no falsear el reparto real.
  const { bars: countryBars, total: countryTotal } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of touchRows) {
      const iso = countryISOForPhone(r.phone)
      const key = iso ? countryNameForISO(iso) : 'Sin prefijo'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return buildBars(counts, 12)
  }, [touchRows])

  // Opciones del selector de fuente de tráfico (a partir de las agendas cargadas).
  const sourceOptions = useMemo(() => {
    const set = new Set<string>()
    for (const a of apptRows) {
      const s = (a.source || a.utm_source || '').trim()
      if (s) set.add(s)
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y))
  }, [apptRows])

  // Agendas filtradas por campaña ("contiene") y fuente de tráfico.
  const filteredAppts = useMemo(() => {
    const camp = normalizeText(campaignFilter.trim())
    return apptRows.filter((a) => {
      if (camp && !normalizeText(String(a.utm_campaign ?? '')).includes(camp)) return false
      if (sourceFilter === 'all') return true
      if (sourceFilter === '__paid__') return isPaidSource(a.utm_source, a.source)
      const s = (a.source || a.utm_source || '').trim()
      return s === sourceFilter
    })
  }, [apptRows, campaignFilter, sourceFilter])

  const { bars: apptSourceBars, total: apptSourceTotal } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of filteredAppts) {
      const key = (a.source || a.utm_source || '').trim() || NO_UTM
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return buildBars(counts, 10)
  }, [filteredAppts])

  const { bars: apptCampaignBars, total: apptCampaignTotal } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of filteredAppts) {
      const key = (a.utm_campaign || '').trim() || NO_UTM
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return buildBars(counts, 10)
  }, [filteredAppts])

  // Desglose de agendas POR FECHA (no global) — lo que pidió el equipo de ads.
  const apptByDate = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of filteredAppts) {
      const key = String(a.appointment_datetime ?? '').slice(0, 10)
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    // Orden cronológico descendente (lo más reciente primero).
    const bars = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => (a.label < b.label ? 1 : -1))
    const total = bars.reduce((s, b) => s + b.count, 0)
    return { bars, total }
  }, [filteredAppts])

  const hasApptFilters = periodPreset !== 'all' || !!campaignFilter.trim() || sourceFilter !== 'all'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-cyan-400" /> Atribución
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          De dónde vienen los leads, las agendas y las ventas — por fuente y anuncio
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Leads" value={loading ? '—' : totals.leads} icon={Users} loading={loading} />
        <KPICard title="Agendas" value={loading ? '—' : totals.appts} icon={Calendar} loading={loading} />
        <KPICard title="Ventas" value={loading ? '—' : totals.sales} icon={ShoppingCart} loading={loading} />
        <KPICard
          title="Facturación"
          value={loading ? '—' : formatCurrency(totals.gross)}
          icon={TrendingUp}
          loading={loading}
        />
      </div>

      {/* Top campañas First / Last touch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Target className="w-4 h-4 text-brand-400" /> Top anuncios / campañas (First-touch)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">La campaña que originó cada lead</p>
          <BarList bars={firstCampaignBars} total={firstCampaignTotal} color="violet" loading={loadingTouch} />
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-400" /> Top campañas (Last-touch)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">La última campaña que tocó al lead</p>
          <BarList bars={lastCampaignBars} total={lastCampaignTotal} color="cyan" loading={loadingTouch} />
        </div>
      </div>

      {/* Top fuentes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" /> Top fuentes
          </h3>
          <p className="text-xs text-muted-foreground mb-4">De qué canal vienen los leads</p>
          <BarList bars={sourceBars} total={sourceTotal} color="emerald" loading={loadingTouch} />
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-400" /> Top países
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Según el prefijo del teléfono del contacto</p>
          <BarList bars={countryBars} total={countryTotal} color="violet" loading={loadingTouch} emptyLabel="Sin teléfonos con prefijo detectable." />
        </div>
      </div>

      {/* Embudo por fuente (RPC) */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Embudo por fuente / anuncio</h3>
        {loading ? (
          <div className="h-40 animate-pulse bg-muted rounded" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de atribución todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2">Fuente / Anuncio</th>
                  <th className="text-right font-medium py-2">Leads</th>
                  <th className="text-right font-medium py-2">Agendas</th>
                  <th className="text-right font-medium py-2">Ventas</th>
                  <th className="text-right font-medium py-2">Lead→Venta</th>
                  <th className="text-right font-medium py-2">Facturación</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const leadToSale = r.leads ? (r.sales / r.leads) * 100 : 0
                  return (
                    <tr key={r.source} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 text-foreground max-w-[240px] truncate">{r.source}</td>
                      <td className="py-2.5 text-right text-foreground">{r.leads}</td>
                      <td className="py-2.5 text-right text-foreground">{r.appointments}</td>
                      <td className="py-2.5 text-right text-foreground">{r.sales}</td>
                      <td className="py-2.5 text-right">
                        <span className={leadToSale >= 15 ? 'text-emerald-400' : 'text-muted-foreground'}>
                          {leadToSale.toFixed(0)}%
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-foreground">{formatCurrency(r.gross)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* De dónde vienen las agendas */}
      <div>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-400" /> ¿De dónde vienen las agendas?
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Atribución de las citas agendadas, por fecha, fuente y campaña</p>
      </div>

      {/* Filtros de la sección de agendas: fecha + campaña (contiene) + fuente de tráfico */}
      <div className="flex flex-wrap items-end gap-3">
        <PeriodFilterBar
          preset={periodPreset}
          onPresetChange={setPeriodPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
          onClear={() => { setPeriodPreset('all'); setCustomFrom(''); setCustomTo(''); setCampaignFilter(''); setSourceFilter('all') }}
          hasActiveFilters={hasApptFilters}
          className="flex-1 min-w-[280px]"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Nombre de campaña (contiene)</span>
          <input
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            placeholder="p. ej. VSL"
            className="text-sm rounded-lg border border-border bg-muted px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500 w-52 h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Fuente de tráfico</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-sm rounded-lg border border-border bg-muted px-3 py-2 text-foreground focus:outline-none focus:border-brand-500 h-9"
          >
            <option value="all">Todas las fuentes</option>
            <option value="__paid__">Solo tráfico pago (Meta)</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Agendas por fuente</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {loadingAppts ? '—' : `${apptSourceTotal} agenda${apptSourceTotal === 1 ? '' : 's'} en total`}
          </p>
          <BarList bars={apptSourceBars} total={apptSourceTotal} color="violet" loading={loadingAppts} />
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Agendas por campaña</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {loadingAppts ? '—' : `${apptCampaignTotal} agenda${apptCampaignTotal === 1 ? '' : 's'} en total`}
          </p>
          <BarList bars={apptCampaignBars} total={apptCampaignTotal} color="cyan" loading={loadingAppts} />
        </div>
      </div>

      {/* Agendas por FECHA (desglose diario, no global) */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" /> Agendas por fecha
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {loadingAppts ? '—' : `Desglose diario · ${apptByDate.total} agenda${apptByDate.total === 1 ? '' : 's'}`}
        </p>
        <div className="max-h-[360px] overflow-y-auto pr-1">
          <BarList bars={apptByDate.bars} total={apptByDate.total} color="emerald" loading={loadingAppts} emptyLabel="Sin agendas en este rango con los filtros aplicados." />
        </div>
      </div>

      {/* First vs Last (tabla secundaria) */}
      <div>
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-muted-foreground" /> First-touch vs Last-touch por contacto
        </h2>
        <p className="text-muted-foreground text-xs mt-1">
          De qué campaña vino originalmente cada lead vs cuál fue la última que le tocó
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        {loadingTouch ? (
          <div className="h-40 animate-pulse bg-muted rounded" />
        ) : touchRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de atribución todavía.</p>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2">Contacto</th>
                  <th className="text-left font-medium py-2">First Source</th>
                  <th className="text-left font-medium py-2">First Campaign</th>
                  <th className="text-left font-medium py-2">Last Source</th>
                  <th className="text-left font-medium py-2">Last Campaign</th>
                  <th className="text-left font-medium py-2">Primer contacto</th>
                  <th className="text-left font-medium py-2">Último</th>
                </tr>
              </thead>
              <tbody>
                {touchRows.map((r) => (
                  <tr key={r.contact_id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 text-foreground max-w-[180px] truncate">{r.contact_name}</td>
                    <td className="py-2.5 text-foreground">{r.first_utm_source || '—'}</td>
                    <td className="py-2.5 text-foreground max-w-[160px] truncate">{r.first_utm_campaign || '—'}</td>
                    <td className="py-2.5 text-foreground">{r.last_utm_source || '—'}</td>
                    <td className="py-2.5 text-foreground max-w-[160px] truncate">{r.last_utm_campaign || '—'}</td>
                    <td className="py-2.5 text-muted-foreground">{formatDate(r.first_touch_at)}</td>
                    <td className="py-2.5 text-muted-foreground">{formatDate(r.last_touch_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Calidad de leads — respuestas del formulario */}
      <div>
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" /> Calidad de leads (respuestas del formulario)
        </h2>
        <p className="text-muted-foreground text-xs mt-1">
          Qué respondió cada lead al agendar, junto con la fuente de la que vino. Se conserva aunque reprograme la cita.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={qualSource}
            onChange={(e) => setQualSource(e.target.value)}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-brand-500"
          >
            <option value="all">Todas las fuentes</option>
            {qualSources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            value={qualSearch}
            onChange={(e) => setQualSearch(e.target.value)}
            placeholder="Buscar por nombre o respuesta…"
            className="flex-1 min-w-[200px] bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500"
          />
          <span className="text-xs text-muted-foreground">{filteredQual.length} leads</span>
        </div>
        {loadingQual ? (
          <div className="h-40 animate-pulse bg-muted rounded" />
        ) : filteredQual.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin respuestas de formulario todavía.</p>
        ) : (
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2 pr-3">Contacto</th>
                  <th className="text-left font-medium py-2 pr-3">Fuente</th>
                  {QUALIFICATION_KEYS.map((k) => (
                    <th key={k} className="text-left font-medium py-2 pr-3 whitespace-nowrap">{labelFor(k)}</th>
                  ))}
                  <th className="text-left font-medium py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {filteredQual.map((r) => (
                  <tr key={r.contact_id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-2.5 pr-3 text-foreground max-w-[160px] truncate">
                      <a href={`/${tenant}/crm/contactos/${r.contact_id}`} className="hover:text-brand-400 hover:underline">{r.contact_name}</a>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.source || '—'}</td>
                    {QUALIFICATION_KEYS.map((k) => (
                      <td key={k} className="py-2.5 pr-3 text-foreground max-w-[220px]" title={r.answers[k] || ''}>
                        <span className="line-clamp-2">{r.answers[k] || '—'}</span>
                      </td>
                    ))}
                    <td className="py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
