'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { funnelBySource, leadDate } from '@/lib/analytics'
import { metodoDePlan } from '@/lib/metrics/agregados'
import { canonicalizeAppointments, canonicalizeLeads } from '@/lib/canonical/dedup'
import { createClient } from '@/lib/supabase/client'
import {
  Megaphone,
  Users,
  Calendar,
  ShoppingCart,
  TrendingUp,
  ArrowLeftRight,
  Target,
  Layers,
  ClipboardList,
  Globe,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { KPICard } from '@/components/os/DashboardKPICard'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD, getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { isPaidSource } from '@/lib/ads/funnel'
import { AttributionCoverage } from '@/components/os/AttributionCoverage'
import { QUALIFICATION_KEYS, labelFor, type QualificationAnswer } from '@/lib/qualification'
import { countryISOForPhone, countryNameForISO } from '@/lib/phone'
import { useTenant, useTenantId } from '@/lib/tenant-context'
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
// Etiqueta que la RPC attribution_funnel_for_tenant usa para leads sin fuente ni UTM.
const DIRECTO_RPC = 'Directo / Sin atribuir'

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
    cyan: 'text-brand-400',
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
  const tenantId = useTenantId()
  const [globalError, setGlobalError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<FunnelRow[]>([])
  const [loadingTouch, setLoadingTouch] = useState(true)
  const [touchRows, setTouchRows] = useState<UtmTouchRow[]>([])
  const [apptError, setApptError] = useState(false)
  const [qualError, setQualError] = useState(false)
  const [loadingAppts, setLoadingAppts] = useState(true)
  const [apptRows, setApptRows] = useState<AppointmentRow[]>([])
  const [loadingQual, setLoadingQual] = useState(true)
  const [qualRows, setQualRows] = useState<LeadQualityRow[]>([])
  const [qualSource, setQualSource] = useState('all')
  const [qualSearch, setQualSearch] = useState('')

  // Filtros de la sección de agendas (pedido por el equipo de ads).
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])
  // Instantes ISO (frontera del día en la zona del negocio): `YYYY-MM-DDT00:00:00` sin zona lo
  // interpreta Postgres en UTC y desplaza el corte 1-2 h; el `23:59:59` pierde el último segundo.
  const rangeFrom = useMemo(() => (range.from ? range.from.toISOString() : null), [range.from])
  const rangeTo = useMemo(() => (range.to ? range.to.toISOString() : null), [range.to])

  // Funnel por fuente (RPC) + first/last touch — globales, se cargan una vez.
  useEffect(() => {
    let mounted = true
    async function loadGlobal() {
      const supabase = createClient()
      setLoading(true)
      setGlobalError(false)
      const [contactsRes, apptsRes, salesRes, touchRes] = await Promise.all([
        fetchAllRows(() =>
          supabase
            .from('contacts')
            .select('id,email,phone,created_at,first_seen_at', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('id')
        ),
        fetchAllRows(() =>
          supabase
            .from('appointments')
            .select('id,contact_id,status,appointment_datetime,setter_id,closer_id', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('id')
        ),
        fetchAllRows(() =>
          supabase
            .from('sales')
            .select(
              'id,contact_id,status,sale_date,gross_amount,setter_id,closer_id,reservation_completed_at,payment_plans(method)',
              { count: 'exact' }
            )
            .eq('tenant_id', tenantId)
            .order('id')
        ),
        fetchAllRows(() =>
          supabase
            .from('contact_attributions')
            .select(
              'contact_id,source,utm_source,utm_campaign,utm_content,is_primary,first_utm_source,first_utm_campaign,last_utm_source,last_utm_campaign,first_touch_at,last_touch_at,contacts(full_name,phone)',
              { count: 'exact' }
            )
            .eq('tenant_id', tenantId)
            .order('id')
        ),
      ])
      if (!mounted) return
      if ([contactsRes, apptsRes, salesRes, touchRes].some((r) => r.error || r.truncated)) {
        setGlobalError(true)
        setRows([])
        setTouchRows([])
        setLoading(false)
        setLoadingTouch(false)
        return
      }
      const canonicalLeads = canonicalizeLeads(
        (contactsRes.rows ?? []).map((c) => ({ ...c, created_at: leadDate(c) }))
      ).leads
      const aliases = new Map(canonicalLeads.flatMap((c) => c.members.map((m) => [m.id, c.leadId] as const)))
      const leadIds = canonicalLeads.filter((c) => inPeriod(c.createdAt, range)).map((c) => c.leadId)
      const appts = apptsRes.rows ?? []
      const byId = new Map(appts.map((a) => [a.id, a]))
      const uniqueAppointments = canonicalizeAppointments(
        appts.map((a) => ({
          ...a,
          scheduled_at: a.appointment_datetime,
          calendly_event_id: null,
          calendar_event_id: null,
        }))
      )
        .appointments.map((a) => byId.get(a.appointmentId)!)
        .filter((a) => inPeriod(a.appointment_datetime, range))
      const periodSales = (salesRes.rows ?? [])
        .map((v) => ({ ...v, payment_plan_method: metodoDePlan(v) }))
        .filter((v) => inPeriod(v.sale_date, range))
      setRows(
        funnelBySource(
          leadIds,
          touchRes.rows.map((a) => ({ ...a, contact_id: aliases.get(a.contact_id) ?? a.contact_id })),
          periodSales.map((a) => ({ ...a, contact_id: aliases.get(a.contact_id ?? '') ?? a.contact_id })),
          uniqueAppointments.map((a) => ({ ...a, contact_id: aliases.get(a.contact_id ?? '') ?? a.contact_id }))
        )
      )
      setLoading(false)
      setTouchRows(
        (touchRes.rows || [])
          .filter((r) => leadIds.includes(aliases.get(r.contact_id) ?? r.contact_id))
          .map((r: any) => ({
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
    return () => {
      mounted = false
    }
  }, [tenantId, range])

  // Agendas — se recargan cuando cambia el rango de fechas (el filtro de campaña/fuente
  // se aplica en cliente sobre lo cargado).
  useEffect(() => {
    let mounted = true
    async function loadAppts() {
      setLoadingAppts(true)
      setApptError(false)
      const supabase = createClient()
      const makeQuery = () => {
        let q = supabase
          .from('appointments')
          .select('id, contact_id, status, source, utm_source, utm_campaign, appointment_datetime', { count: 'exact' })
          .eq('tenant_id', tenantId)
          .order('appointment_datetime', { ascending: false })
        if (rangeFrom) q = q.gte('appointment_datetime', rangeFrom)
        if (rangeTo) q = q.lte('appointment_datetime', rangeTo)
        return q.order('id')
      }
      const { rows: data, error, truncated } = await fetchAllRows(makeQuery)
      if (!mounted) return
      if (error || truncated) {
        setApptError(true)
        setApptRows([])
        setLoadingAppts(false)
        return
      }
      const appts = data ?? []
      const byId = new Map(appts.map((a) => [a.id, a]))
      setApptRows(
        canonicalizeAppointments(
          appts.map((a) => ({
            ...a,
            scheduled_at: a.appointment_datetime,
            calendly_event_id: null,
            calendar_event_id: null,
          }))
        ).appointments.map((a) => byId.get(a.appointmentId)!)
      )
      setLoadingAppts(false)
    }
    loadAppts()
    return () => {
      mounted = false
    }
  }, [rangeFrom, rangeTo, tenantId])

  // Calidad de leads — respuestas del formulario por contacto (con su fuente primaria).
  useEffect(() => {
    let mounted = true
    async function loadQual() {
      const supabase = createClient()
      setLoadingQual(true)
      setQualError(false)
      const {
        rows: data,
        error,
        truncated,
      } = await fetchAllRows(() =>
        supabase
          .from('contacts')
          .select(
            'id, full_name, created_at, first_seen_at, qualification, qualification_updated_at, contact_attributions(source, utm_campaign, is_primary)'
          )
          .eq('tenant_id', tenantId)
          .not('qualification', 'is', null)
          .order('qualification_updated_at', { ascending: false })
          .order('id')
      )
      if (!mounted) return
      if (error || truncated) {
        setQualError(true)
        setQualRows([])
        setLoadingQual(false)
        return
      }
      setQualRows(
        (data || [])
          .filter((r) => inPeriod(leadDate(r), range))
          .map((r: any) => {
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
    return () => {
      mounted = false
    }
  }, [tenantId, range])

  const qualSources = useMemo(() => Array.from(new Set(qualRows.map((r) => r.source || NO_UTM))).sort(), [qualRows])
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

  // COBERTURA DE ATRIBUCIÓN (§21): parte de leads/ventas/revenue con origen conocido, calculada
  // sobre los mismos totales de la RPC por fuente (coherente con las barras de arriba).
  const coverage = useMemo(() => {
    const pctOrNull = (attributed: number, total: number) => (total > 0 ? (attributed / total) * 100 : null)
    const directo = rows.find((r) => r.source === DIRECTO_RPC)
    const attributedLeads = totals.leads - (directo?.leads ?? 0)
    const attributedSales = totals.sales - (directo?.sales ?? 0)
    return {
      leads: pctOrNull(attributedLeads, totals.leads),
      sales: pctOrNull(attributedSales, totals.sales),
      // La facturación atribuida se obtiene del mismo desglose y población que el total.
      revenue: pctOrNull(totals.gross - (directo?.gross ?? 0), totals.gross),
    }
  }, [rows, totals])

  return (
    <div className="dashboard-surface space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-brand-400" /> Atribución
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Actividad del periodo por fuente registrada y anuncio. Una fuente de importación no demuestra atribución
          publicitaria. Las ventas excluyen reservas abiertas; los recuentos no representan una cohorte de conversión.
        </p>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />
      {globalError && (
        <p role="alert" className="dashboard-card p-5">
          No se pudo cargar la fuente completa de atribución. Recarga para reintentar.
        </p>
      )}
      {qualError && <p role="alert">No se pudo cargar la calidad de los contactos del periodo.</p>}
      {apptError && (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el desglose de agendas completo.
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Leads" value={loading || globalError ? '—' : totals.leads} icon={Users} loading={loading} />
        <KPICard
          title="Agendas"
          value={loading || globalError ? '—' : totals.appts}
          icon={Calendar}
          loading={loading}
        />
        <KPICard
          title="Ventas"
          value={loading || globalError ? '—' : totals.sales}
          icon={ShoppingCart}
          loading={loading}
        />
        <KPICard
          title="Facturación"
          value={loading || globalError ? '—' : formatCurrency(totals.gross)}
          icon={TrendingUp}
          loading={loading}
        />
      </div>

      {/* Cobertura de atribución (§21): movida aquí desde Métricas y KPIs — pertenece al panel
          donde se diagnostica la atribución, no al resumen del negocio. */}
      <AttributionCoverage coverage={globalError ? { leads: null, sales: null, revenue: null } : coverage} />

      {/* Top campañas First / Last touch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Target className="w-4 h-4 text-brand-400" /> Top anuncios / campañas (First-touch)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Primer toque registrado de los leads del periodo</p>
          <BarList bars={firstCampaignBars} total={firstCampaignTotal} color="violet" loading={loadingTouch} />
        </div>

        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Target className="w-4 h-4 text-brand-400" /> Top campañas (Last-touch)
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Último toque registrado de los leads del periodo</p>
          <BarList bars={lastCampaignBars} total={lastCampaignTotal} color="cyan" loading={loadingTouch} />
        </div>
      </div>

      {/* Top fuentes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" /> Top fuentes
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Fuentes registradas; una importación no demuestra un canal publicitario
          </p>
          <BarList bars={sourceBars} total={sourceTotal} color="emerald" loading={loadingTouch} />
        </div>

        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-400" /> Top países
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Según el prefijo del teléfono del contacto</p>
          <BarList
            bars={countryBars}
            total={countryTotal}
            color="violet"
            loading={loadingTouch}
            emptyLabel="Sin teléfonos con prefijo detectable."
          />
        </div>
      </div>

      {/* Embudo por fuente (RPC) */}
      <div className="dashboard-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Actividad por fuente / anuncio</h3>
        {loading ? (
          <div className="h-40 animate-pulse bg-muted rounded" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de atribución todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-2xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2">Fuente / Anuncio</th>
                  <th className="text-right font-medium py-2">Leads</th>
                  <th className="text-right font-medium py-2">Agendas</th>
                  <th className="text-right font-medium py-2">Ventas</th>
                  <th className="text-right font-medium py-2">Conversión</th>
                  <th className="text-right font-medium py-2">Facturación</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  return (
                    <tr key={r.source} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 text-foreground max-w-[240px] truncate">{r.source}</td>
                      <td className="py-2.5 text-right text-foreground">{r.leads}</td>
                      <td className="py-2.5 text-right text-foreground">{r.appointments}</td>
                      <td className="py-2.5 text-right text-foreground">{r.sales}</td>
                      <td className="py-2.5 text-right">
                        <span title="Requiere una cohorte de leads vinculada a sus ventas, con maduración comparable">
                          —
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
        <p className="text-muted-foreground text-sm mt-1">
          Citas por fecha, origen de registro y campaña UTM. Calendly o una importación no demuestran un canal
          publicitario.
        </p>
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
          onClear={() => {
            setPeriodPreset('all')
            setCustomFrom('')
            setCustomTo('')
            setCampaignFilter('')
            setSourceFilter('all')
          }}
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
          <span className="text-xs text-muted-foreground">Fuente u origen de registro</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-sm rounded-lg border border-border bg-muted px-3 py-2 text-foreground focus:outline-none focus:border-brand-500 h-9"
          >
            <option value="all">Todas las fuentes</option>
            <option value="__paid__">Solo tráfico pago (Meta)</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Agendas por origen registrado</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {loadingAppts ? '—' : `${apptSourceTotal} agenda${apptSourceTotal === 1 ? '' : 's'} en total`}
          </p>
          <BarList bars={apptSourceBars} total={apptSourceTotal} color="violet" loading={loadingAppts} />
        </div>

        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Agendas por campaña</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {loadingAppts ? '—' : `${apptCampaignTotal} agenda${apptCampaignTotal === 1 ? '' : 's'} en total`}
          </p>
          <BarList bars={apptCampaignBars} total={apptCampaignTotal} color="cyan" loading={loadingAppts} />
        </div>
      </div>

      {/* Agendas por FECHA (desglose diario, no global) */}
      <div className="dashboard-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" /> Agendas por fecha
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {loadingAppts ? '—' : `Desglose diario · ${apptByDate.total} agenda${apptByDate.total === 1 ? '' : 's'}`}
        </p>
        <div className="max-h-[360px] overflow-y-auto pr-1">
          <BarList
            bars={apptByDate.bars}
            total={apptByDate.total}
            color="emerald"
            loading={loadingAppts}
            emptyLabel="Sin agendas en este rango con los filtros aplicados."
          />
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

      <div className="dashboard-card p-5">
        {loadingTouch ? (
          <div className="h-40 animate-pulse bg-muted rounded" />
        ) : touchRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de atribución todavía.</p>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-2xs uppercase tracking-wider text-muted-foreground border-b border-border">
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

      <div className="dashboard-card p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={qualSource}
            onChange={(e) => setQualSource(e.target.value)}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-brand-500"
          >
            <option value="all">Todas las fuentes</option>
            {qualSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
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
                <tr className="text-2xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2 pr-3">Contacto</th>
                  <th className="text-left font-medium py-2 pr-3">Fuente</th>
                  {QUALIFICATION_KEYS.map((k) => (
                    <th key={k} className="text-left font-medium py-2 pr-3 whitespace-nowrap">
                      {labelFor(k)}
                    </th>
                  ))}
                  <th className="text-left font-medium py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {filteredQual.map((r) => (
                  <tr key={r.contact_id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-2.5 pr-3 text-foreground max-w-[160px] truncate">
                      <a
                        href={`/${tenant}/crm/contactos/${r.contact_id}`}
                        className="hover:text-brand-400 hover:underline"
                      >
                        {r.contact_name}
                      </a>
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
