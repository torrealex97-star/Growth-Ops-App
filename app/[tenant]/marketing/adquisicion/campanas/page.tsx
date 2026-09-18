'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Radio, Plus, X, Pencil, Receipt, CheckCircle2, RefreshCw, AlertTriangle, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber } from '@/lib/utils'
import type { Campaign } from '@/lib/types/database'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, PERIOD_LABELS, type PeriodPreset } from '@/lib/filters/period'
import { useUrlFilters } from '@/lib/filters/use-url-filters'
import { readEnum } from '@/lib/filters/url-state'
import { AdsFunnelPanel, type CampaignTargets } from '@/components/os/AdsFunnelPanel'
import { DailyMetricsPanel } from '@/components/os/DailyMetricsPanel'
import { AdsTable } from '@/components/os/AdsTable'
import { MultiSelect } from '@/components/ui/multi-select'
import { useSesion, useTenant } from '@/lib/tenant-context'
import { useCuentasMetaActivas } from '@/lib/meta/use-cuentas-activas'
import { DEFAULT_PERIOD } from '@/lib/filters/period'

// Valores por defecto de los filtros: cuando uno está en su valor por defecto NO se escribe en la
// URL, así el enlace limpio sigue siendo limpio.
const FILTROS_POR_DEFECTO = { period: DEFAULT_PERIOD, account: 'all' }
const PRESETS_VALIDOS = Object.keys(PERIOD_LABELS) as PeriodPreset[]

// Gasto y métricas de ads agregadas por campaña dentro del rango seleccionado (campaign_daily).
type RangeMetrics = {
  spend: number
  impressions: number
  clicks: number
  leads: number
  reach: number
  link_clicks: number
  landing_views: number
}

const CHANNELS = [
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'tiktok_ads', label: 'TikTok Ads' },
  { value: 'youtube_ads', label: 'YouTube Ads' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'otro', label: 'Otro' },
] as const

const TYPES = [
  { value: 'prospeccion', label: 'Prospección' },
  { value: 'retargeting', label: 'Retargeting' },
  { value: 'lookalike', label: 'Lookalike' },
  { value: 'brand', label: 'Brand' },
] as const

const STATUSES = [
  { value: 'activa', label: 'Activa' },
  { value: 'pausada', label: 'Pausada' },
  { value: 'finalizada', label: 'Finalizada' },
] as const

const channelLabel = (v: string) => CHANNELS.find((c) => c.value === v)?.label || v
const statusBadge = (s: string) => {
  if (s === 'activa') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (s === 'pausada') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-muted/30 text-muted-foreground border-border/30'
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const fmtNum = (n: number | null, decimals = 2) =>
  n === null ? '—' : formatNumber(n, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

type NewCampaign = {
  name: string
  channel: string
  type: string
  start_date: string
  end_date: string
  budget: string
  adspend: string
  impressions: string
  clicks: string
  leads_generated: string
  ad_source: string
  notes: string
}

const emptyForm: NewCampaign = {
  name: '',
  channel: 'meta_ads',
  type: 'prospeccion',
  start_date: '',
  end_date: '',
  budget: '',
  adspend: '',
  impressions: '',
  clicks: '',
  leads_generated: '',
  ad_source: '',
  notes: '',
}

type QuickEdit = {
  adspend: string
  impressions: string
  clicks: string
  leads_generated: string
}

const currentPeriod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Fecha local → YYYY-MM-DD (sin desfase de zona horaria que sí tendría toISOString()).
const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CampaignsPage() {
  const tenant = useTenant()
  const sesion = useSesion()
  const cuentas = useCuentasMetaActivas(tenant)
  const [items, setItems] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [nc, setNc] = useState<NewCampaign>(emptyForm)
  const [editing, setEditing] = useState<Campaign | null>(null)
  const [qe, setQe] = useState<QuickEdit>({ adspend: '', impressions: '', clicks: '', leads_generated: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [accountingIds, setAccountingIds] = useState<Record<string, boolean>>({})
  const [postingId, setPostingId] = useState<string | null>(null)
  // Los filtros arrancan desde la URL (§6): refrescar o mandar el enlace conserva el contexto, y
  // antes volvía a "Todo / Todas las cuentas" sin avisar, así que dos personas podían creer que
  // miraban lo mismo con periodos distintos.
  const urlFilters = useUrlFilters(FILTROS_POR_DEFECTO)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(() =>
    readEnum(urlFilters.get('period'), PRESETS_VALIDOS, DEFAULT_PERIOD)
  )
  const [customFrom, setCustomFrom] = useState(() => urlFilters.get('from') ?? '')
  const [customTo, setCustomTo] = useState(() => urlFilters.get('to') ?? '')
  const [accountFilter, setAccountFilter] = useState<string>(() => urlFilters.get('account') ?? 'all')
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>(() => {
    const raw = urlFilters.get('campaign')
    return raw ? raw.split(',').filter(Boolean) : []
  })
  const [rangeMap, setRangeMap] = useState<Record<string, RangeMetrics> | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingDaily, setSyncingDaily] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [croning, setCroning] = useState(false)
  const [view, setView] = useState<'campaigns' | 'ads'>('campaigns')
  const [syncingAds, setSyncingAds] = useState(false)
  const [adsVersion, setAdsVersion] = useState(0)
  const [targets, setTargets] = useState<CampaignTargets | null>(null)
  const [showTargets, setShowTargets] = useState(false)
  const [targetsForm, setTargetsForm] = useState({ target_roas: '', target_cac: '', target_cpl: '' })
  const [savingTargets, setSavingTargets] = useState(false)

  const period = useMemo(() => currentPeriod(), [])

  const isAdmin = role === 'admin' || role === 'director' || role === 'manager' || role === 'marketing'

  const lastSync = useMemo(() => {
    const times = items.map((c) => c.synced_at).filter(Boolean) as string[]
    return times.length ? times.sort().slice(-1)[0] : null
  }, [items])

  // "Desde el lanzamiento" = la primera fecha con datos reales de esta subcuenta, no una fecha
  // inventada. Si todavía no hay campañas, se queda sin límite inferior (todo lo disponible).
  const launchDate = useMemo(() => {
    const fechas = items.map((c) => c.start_date).filter(Boolean) as string[]
    return fechas.length ? fechas.sort()[0] : null
  }, [items])

  // UN solo rango para KPIs, gráficas, funnel y tabla (§5): si cada panel calculara el suyo,
  // podrían discrepar sin que nada lo delate.
  const range = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo, { launchDate }),
    [periodPreset, customFrom, customTo, launchDate]
  )

  // Escribir los filtros en la URL. Va en un efecto para que también quede reflejado lo que se
  // cambia desde los paneles, no solo desde la barra.
  useEffect(() => {
    urlFilters.set({
      period: periodPreset,
      from: periodPreset === 'custom' || periodPreset === 'day' ? customFrom : '',
      to: periodPreset === 'custom' ? customTo : '',
      account: accountFilter,
      campaign: selectedCampaignIds.join(','),
    })
  }, [periodPreset, customFrom, customTo, accountFilter, selectedCampaignIds, urlFilters])

  // Campañas filtradas por las cuentas configuradas en Integraciones (no todas las que ve el token).
  const itemsFiltrados = useMemo(() => cuentas.filtrar(items), [items, cuentas])

  // Cuentas publicitarias presentes (para el desplegable de filtro). Solo campañas
  // de las cuentas configuradas en Integraciones. Se muestran por NOMBRE
  // (account_name), con fallback al id act_XXX si aún no se sincronizó el nombre.
  const accounts = useMemo(() => {
    const byId = new Map<string, string>()
    for (const c of itemsFiltrados) {
      if (!c.account_id) continue
      const label = c.account_name || byId.get(c.account_id) || c.account_id
      byId.set(c.account_id, label)
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [itemsFiltrados])

  // Fechas del rango en formato YYYY-MM-DD (local) para el endpoint de gasto por rango.
  const rangeFrom = useMemo(() => (range.from ? ymdLocal(range.from) : null), [range.from])
  const rangeTo = useMemo(() => (range.to ? ymdLocal(range.to) : null), [range.to])

  // Gasto REAL del periodo (campaign_daily). Solo cuando hay un periodo activo (no "Todo").
  // Cuando no hay periodo, mostramos el total histórico (adspend de la campaña) como siempre.
  useEffect(() => {
    if (periodPreset === 'all' || !rangeFrom || !rangeTo) {
      setRangeMap(null)
      return
    }
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/meta/spend-range?from=${rangeFrom}&to=${rangeTo}`)
        const json = await res.json()
        if (active) setRangeMap(res.ok ? (json.byCampaign ?? {}) : {})
      } catch {
        if (active) setRangeMap({})
      }
    })()
    return () => {
      active = false
    }
  }, [periodPreset, rangeFrom, rangeTo, tenant])

  // ¿Tenemos serie diaria para este rango? Si aún no se ha sincronizado (mapa vacío), caemos al
  // comportamiento anterior (filtro por fecha de inicio) para no dejar la página en blanco.
  const hasDaily = !!rangeMap && Object.keys(rangeMap).length > 0
  const periodActive = periodPreset !== 'all'

  const campaignOptions = useMemo(
    () =>
      itemsFiltrados
        .filter((c) => accountFilter === 'all' || c.account_id === accountFilter)
        .map((c) => ({ value: c.id, label: c.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [itemsFiltrados, accountFilter]
  )

  const filteredItems = useMemo(
    () =>
      itemsFiltrados.filter((c) => {
        if (accountFilter !== 'all' && c.account_id !== accountFilter) return false
        if (selectedCampaignIds.length && !selectedCampaignIds.includes(c.id)) return false
        if (!periodActive) return true
        // Periodo activo: si hay serie diaria, una campaña Meta entra si TUVO gasto en el rango;
        // las manuales (sin serie) se filtran por su fecha de inicio. Sin serie aún → fecha inicio.
        if (hasDaily && c.provider === 'meta') return !!rangeMap![c.id]
        return inPeriod(c.start_date, range)
      }),
    [itemsFiltrados, range, accountFilter, selectedCampaignIds, periodActive, hasDaily, rangeMap]
  )

  // Métricas mostradas: dentro de un periodo con serie diaria, se sustituyen gasto/impresiones/
  // clics/leads por los del rango; fuera de eso, se usan los totales históricos de la campaña.
  const displayItems = useMemo(() => {
    if (!periodActive || !hasDaily) return filteredItems
    return filteredItems.map((c) => {
      const d = rangeMap![c.id]
      if (!d) return c
      // Todas las métricas nativas de ads (las que tienen serie diaria) se reemplazan por las del
      // rango, de modo que alcance, clics de enlace y visitas a la página —y sus derivadas (CPC,
      // CTR, % de carga, coste por visita)— reflejen el periodo, no solo el gasto.
      return {
        ...c,
        adspend: d.spend,
        impressions: d.impressions,
        clicks: d.clicks,
        meta_leads: d.leads,
        leads_generated: d.leads,
        reach: d.reach,
        link_clicks: d.link_clicks,
        landing_views: d.landing_views,
      }
    })
  }, [filteredItems, periodActive, hasDaily, rangeMap])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false })
    if (error) toast.error('Error al cargar campañas', { description: error.message })
    const campaigns = (data as Campaign[]) || []
    setItems(campaigns)
    setLoading(false)

    if (campaigns.length > 0) {
      const sources = campaigns.map((c) => `campaign:${c.id}`)
      const { data: exps, error: expErr } = await supabase
        .from('expenses')
        .select('auto_source')
        .eq('period', period)
        .in('auto_source', sources)
      if (!expErr && exps) {
        const map: Record<string, boolean> = {}
        for (const e of exps as { auto_source: string | null }[]) {
          if (e.auto_source) map[e.auto_source] = true
        }
        setAccountingIds(map)
      }
    }
  }, [period])
  useEffect(() => {
    load()
  }, [load])

  const loadTargets = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/settings/campaign-targets`)
      if (!res.ok) return
      const json = (await res.json()) as CampaignTargets
      setTargets(json)
      setTargetsForm({
        target_roas: json.target_roas?.toString() ?? '',
        target_cac: json.target_cac?.toString() ?? '',
        target_cpl: json.target_cpl?.toString() ?? '',
      })
    } catch {
      // Sin objetivos configurados: los KPIs se muestran sin alerta, no es un error.
    }
  }, [tenant])
  useEffect(() => {
    loadTargets()
  }, [loadTargets])

  const saveTargets = async () => {
    setSavingTargets(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/settings/campaign-targets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_roas: targetsForm.target_roas || null,
          target_cac: targetsForm.target_cac || null,
          target_cpl: targetsForm.target_cpl || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al guardar objetivos')
      toast.success('Objetivos actualizados')
      setShowTargets(false)
      loadTargets()
    } catch (e) {
      toast.error('No se pudieron guardar los objetivos', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setSavingTargets(false)
    }
  }

  useEffect(() => {
    setRole(sesion?.rol ?? null)
  }, [sesion])

  const runSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/meta/sync`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al sincronizar')
      toast.success('Sincronizado con Meta', {
        description: `${json.synced} campañas${json.accounts > 1 ? ` · ${json.accounts} cuentas` : ''} · ${formatCurrency(json.totalSpend)} gasto · ${json.totalMetaLeads} leads Meta · ${formatCurrency(json.monthSpend)} contabilizado en ${period}`,
      })
      load()
      // Refresca también la serie de gasto diario (para los filtros por periodo) en segundo plano.
      fetch(`/api/${tenant}/evergreen/meta/daily-sync`, { method: 'POST' }).catch(() => {})
    } catch (e) {
      toast.error('No se pudo sincronizar con Meta', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setSyncing(false)
    }
  }

  const runDailySync = async () => {
    setSyncingDaily(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/meta/daily-sync`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al sincronizar el gasto diario')
      toast.success('Gasto diario sincronizado', { description: `${json.daysSynced} días · ${json.accounts} cuentas` })
      // Si hay un periodo activo, recarga el mapa de gasto del rango.
      if (periodPreset !== 'all' && range.from && range.to) {
        const r = await fetch(
          `/api/${tenant}/evergreen/meta/spend-range?from=${ymdLocal(range.from)}&to=${ymdLocal(range.to)}`
        )
        const j = await r.json()
        if (r.ok) setRangeMap(j.byCampaign ?? {})
      }
    } catch (e) {
      toast.error('No se pudo sincronizar el gasto diario', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setSyncingDaily(false)
    }
  }

  const runMigrate = async () => {
    setMigrating(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/admin/migrate-meta`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error en la migración')
      toast.success('Migración Meta aplicada', { description: 'Ya puedes sincronizar campañas.' })
    } catch (e) {
      toast.error('No se pudo aplicar la migración', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setMigrating(false)
    }
  }

  const runCronSetup = async () => {
    setCroning(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/admin/setup-meta-cron`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error activando el cron')
      toast.success('Auto 30 min activado', { description: 'Supabase sincronizará Meta cada 30 minutos.' })
    } catch (e) {
      toast.error('No se pudo activar el auto 30 min', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setCroning(false)
    }
  }

  const runAdsSync = async () => {
    setSyncingAds(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/meta/ads-sync`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al sincronizar anuncios')
      toast.success('Anuncios sincronizados', {
        description: `${json.adsSynced} anuncios · ${json.accounts} cuenta(s)`,
      })
      setAdsVersion((v) => v + 1)
    } catch (e) {
      toast.error('No se pudieron sincronizar los anuncios', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSyncingAds(false)
    }
  }

  const updateStatus = async (id: string, status: string) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status: status as Campaign['status'] } : c)))
    const supabase = createClient()
    const { error } = await supabase.from('campaigns').update({ status }).eq('id', id)
    if (error) toast.error('No se pudo actualizar el estado')
  }

  // Contabiliza el gasto de una campaña como gasto de publicidad (idempotente por auto_source+period).
  // Se usa tanto en el auto-enlace (crear/editar) como en el botón manual "Contabilizar en gastos".
  const upsertAdExpense = async (campaignId: string, name: string, adspend: number) => {
    const supabase = createClient()
    return supabase.from('expenses').upsert(
      {
        concept: `Ads - ${name}`,
        category: 'publicidad',
        subcategory: 'ads',
        amount: adspend || 0,
        expense_date: `${period}-01`,
        auto_source: `campaign:${campaignId}`,
        period,
        status: 'pagado',
      },
      { onConflict: 'auto_source,period', ignoreDuplicates: false }
    )
  }

  const create = async () => {
    if (!nc.name.trim()) {
      toast.error('Pon un nombre')
      return
    }
    const supabase = createClient()
    const adspendNum = nc.adspend ? Number(nc.adspend) : 0
    const { data: created, error } = await supabase
      .from('campaigns')
      .insert({
        name: nc.name.trim(),
        channel: nc.channel,
        type: nc.type || null,
        start_date: nc.start_date || null,
        end_date: nc.end_date || null,
        budget: nc.budget ? Number(nc.budget) : 0,
        adspend: adspendNum,
        impressions: nc.impressions ? Number(nc.impressions) : 0,
        clicks: nc.clicks ? Number(nc.clicks) : 0,
        leads_generated: nc.leads_generated ? Number(nc.leads_generated) : 0,
        status: 'activa',
        ad_source: nc.ad_source || null,
        notes: nc.notes || null,
        created_by: sesion?.userId ?? null,
      })
      .select('id, name')
      .single()
    if (error) {
      toast.error('Error al crear', { description: error.message })
      return
    }
    // Auto-enlace: el gasto de ads aparece en Gastos/P&L del mes en curso sin pulsar nada.
    if (created && adspendNum > 0) {
      const { error: expErr } = await upsertAdExpense(created.id as string, created.name as string, adspendNum)
      if (!expErr) setAccountingIds((prev) => ({ ...prev, [`campaign:${created.id}`]: true }))
    }
    toast.success('Campaña creada')
    setShowNew(false)
    setNc(emptyForm)
    load()
  }

  const openEdit = (c: Campaign) => {
    setEditing(c)
    setQe({
      adspend: String(c.adspend ?? 0),
      impressions: String(c.impressions ?? 0),
      clicks: String(c.clicks ?? 0),
      leads_generated: String(c.leads_generated ?? 0),
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    setSavingEdit(true)
    const supabase = createClient()
    const payload = {
      adspend: qe.adspend ? Number(qe.adspend) : 0,
      impressions: qe.impressions ? Number(qe.impressions) : 0,
      clicks: qe.clicks ? Number(qe.clicks) : 0,
      leads_generated: qe.leads_generated ? Number(qe.leads_generated) : 0,
    }
    const { error } = await supabase.from('campaigns').update(payload).eq('id', editing.id)
    if (error) {
      setSavingEdit(false)
      toast.error('No se pudo actualizar', { description: error.message })
      return
    }
    // Auto-enlace: mantener el gasto de ads al día con el gasto real editado.
    if (payload.adspend > 0) {
      const { error: expErr } = await upsertAdExpense(editing.id, editing.name, payload.adspend)
      if (!expErr) setAccountingIds((prev) => ({ ...prev, [`campaign:${editing.id}`]: true }))
    }
    setSavingEdit(false)
    toast.success('Datos actualizados')
    setEditing(null)
    load()
  }

  const postToExpenses = async (c: Campaign) => {
    setPostingId(c.id)
    const { error } = await upsertAdExpense(c.id, c.name, c.adspend || 0)
    setPostingId(null)
    if (error) {
      toast.error('No se pudo contabilizar el gasto', { description: error.message })
      return
    }
    toast.success('Gasto contabilizado', {
      description: `${formatCurrency(c.adspend || 0)} llevado a Gastos / P&L de ${period}`,
    })
    setAccountingIds((prev) => ({ ...prev, [`campaign:${c.id}`]: true }))
  }

  const totalAdspend = displayItems.reduce((s, c) => s + (c.adspend || 0), 0)
  const totalMetaLeads = displayItems.reduce((s, c) => s + (c.meta_leads || 0), 0)
  const totalFunnelLeads = displayItems.reduce((s, c) => s + (c.funnel_leads || 0), 0)
  const totalFollowers = displayItems.reduce((s, c) => s + (c.followers || 0), 0)
  const costPerFollower = div(totalAdspend, totalFollowers)
  const activeCount = displayItems.filter((c) => c.status === 'activa').length

  return (
    <div className="dashboard-surface space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Radio className="w-6 h-6 text-brand-400" /> Campañas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Inversión publicitaria por canal — CPL, CPC, CTR, CPM automáticos
            {lastSync && (
              <span className="ml-2 text-muted-foreground">
                · Meta sincronizado{' '}
                {new Date(lastSync).toLocaleString('es-ES', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
          {isAdmin && (
            <div className="flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 sm:w-auto">
              <button
                onClick={runSync}
                disabled={syncing}
                title="Traer campañas, gasto y leads desde Meta ahora"
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Sincronizando…' : 'Sincronizar con Meta'}
              </button>
              <span className="w-px h-5 bg-border" />
              <button
                onClick={runAdsSync}
                disabled={syncingAds}
                title="Traer el detalle por anuncio (gasto, leads y seguidores) desde Meta"
                aria-label="Sincronizar anuncios"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncingAds ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={runDailySync}
                disabled={syncingDaily}
                title="Traer el gasto DIARIO por campaña (para filtrar por mes/trimestre/año)"
                aria-label="Sincronizar gasto diario"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncingDaily ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setShowTargets(true)}
                title="Fijar objetivos de ROAS/CAC/CPL para las alertas del embudo"
                aria-label="Objetivos de rendimiento"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <AlertTriangle className="w-4 h-4" />
              </button>
              <span className="w-px h-5 bg-border" />
              <button
                onClick={runMigrate}
                disabled={migrating}
                title="Migración Meta — ejecutar una vez para preparar la base de datos"
                aria-label="Migración Meta"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Zap className={`w-4 h-4 ${migrating ? 'animate-pulse' : ''}`} />
              </button>
              <button
                onClick={runCronSetup}
                disabled={croning}
                title="Auto 30 min — programar sincronización automática (Supabase pg_cron)"
                aria-label="Activar sincronización automática cada 30 minutos"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${croning ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
          <button
            onClick={() => setShowNew(true)}
            className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-500 sm:w-auto"
          >
            <Plus className="w-4 h-4" /> Nueva campaña
          </button>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-card p-1 text-sm">
        <button
          onClick={() => setView('campaigns')}
          className={`px-4 py-1.5 rounded-md transition ${view === 'campaigns' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Campañas
        </button>
        <button
          onClick={() => setView('ads')}
          className={`px-4 py-1.5 rounded-md transition ${view === 'ads' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Anuncios
        </button>
      </div>

      {view === 'campaigns' && (
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
            setAccountFilter('all')
            setSelectedCampaignIds([])
          }}
          hasActiveFilters={periodPreset !== 'all' || accountFilter !== 'all' || selectedCampaignIds.length > 0}
        >
          {accounts.length > 1 && (
            <div className="space-y-1.5">
              <label htmlFor="campaign-account-filter" className="block text-xs text-muted-foreground">
                Cuenta publicitaria
              </label>
              <select
                id="campaign-account-filter"
                value={accountFilter}
                onChange={(e) => {
                  setAccountFilter(e.target.value)
                  setSelectedCampaignIds([])
                }}
                className="h-9 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:border-brand-500 focus:outline-none"
              >
                <option value="all">Todas ({accounts.length})</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-0 space-y-1.5">
            <span className="block text-xs text-muted-foreground">Campañas</span>
            <MultiSelect
              options={campaignOptions}
              value={selectedCampaignIds}
              onChange={setSelectedCampaignIds}
              placeholder="Campañas"
              allLabel={`Todas (${campaignOptions.length})`}
              searchPlaceholder="Buscar campaña…"
              className="h-9 w-full min-w-0"
            />
          </div>
        </PeriodFilterBar>
      )}

      {view === 'ads' && <AdsTable campaigns={items} accounts={accounts} version={adsVersion} />}

      {view === 'campaigns' &&
        (loading ? (
          <div className="h-64 bg-card rounded-lg animate-pulse" />
        ) : (
          <>
            {/* Solo lo que el embudo de abajo no cuenta: desfase Meta vs Funnel, y cuántas
                campañas están activas ahora. Inversión/Leads/CPL/ROAS ya son el hero del embudo
                — repetirlos aquí sería la misma cifra dos veces en dos cards distintas. */}
            <div className="dashboard-card flex flex-wrap items-center gap-x-8 gap-y-3 p-4 text-sm">
              <div>
                <span className="text-muted-foreground">Leads Meta </span>
                <span className="font-semibold text-foreground tabular-nums">{formatNumber(totalMetaLeads)}</span>
                <span className="text-muted-foreground"> · Funnel (app) </span>
                <span className="font-semibold text-foreground tabular-nums">{formatNumber(totalFunnelLeads)}</span>
              </div>
              {totalFollowers > 0 && (
                <div>
                  <span className="text-muted-foreground">Seguidores </span>
                  <span className="font-semibold text-foreground tabular-nums">{formatNumber(totalFollowers)}</span>
                  <span className="text-muted-foreground"> · €/seguidor </span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {costPerFollower === null ? '—' : formatCurrency(costPerFollower)}
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Campañas activas </span>
                <span className="font-semibold text-foreground tabular-nums">{activeCount}</span>
              </div>
            </div>

            <AdsFunnelPanel campaigns={displayItems} targets={targets} />

            <DailyMetricsPanel from={rangeFrom} to={rangeTo} />

            {displayItems.length === 0 ? (
              <div className="bg-card/50 border border-border rounded-lg p-10 text-center">
                <p className="text-muted-foreground text-sm">
                  Aún no hay campañas. Crea la primera para empezar a medir CPL, CPC, CTR y CPM.
                </p>
              </div>
            ) : (
              <div className="dashboard-card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-card border-b border-border text-left text-muted-foreground text-xs uppercase">
                      <th className="px-4 py-3">Campaña</th>
                      <th className="px-4 py-3">Canal</th>
                      {accounts.length > 1 && <th className="px-4 py-3">Cuenta</th>}
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Gasto real</th>
                      <th className="px-4 py-3 text-right">Leads Meta</th>
                      <th className="px-4 py-3 text-right">Leads Funnel</th>
                      <th className="px-4 py-3 text-right">CPM</th>
                      <th className="px-4 py-3 text-right">CPC</th>
                      <th className="px-4 py-3 text-right">CTR</th>
                      <th className="px-4 py-3 text-right">CPL</th>
                      <th className="px-4 py-3 text-right">Seguidores</th>
                      <th className="px-4 py-3 text-right">€/Seguidor</th>
                      <th className="px-4 py-3 text-center">Contabilidad</th>
                      <th className="px-4 py-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayItems.map((c) => {
                      const cpm = c.impressions > 0 ? (c.adspend / c.impressions) * 1000 : null
                      const cpc = div(c.adspend, c.clicks)
                      const ctr = div(c.clicks, c.impressions)
                      const cpl = div(c.adspend, c.meta_leads)
                      const isAccounted = !!accountingIds[`campaign:${c.id}`]
                      const isMeta = c.provider === 'meta'
                      // Desfase entre lo que reporta Meta y los leads reales de la app
                      const leadGap = (c.meta_leads || 0) - (c.funnel_leads || 0)
                      const showGap = c.meta_leads > 0 && Math.abs(leadGap) >= Math.max(3, c.meta_leads * 0.2)
                      return (
                        <tr key={c.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-4 py-3 text-foreground">
                            <div className="flex items-center gap-2">
                              <span>{c.name}</span>
                              {isMeta && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  <Zap className="w-2.5 h-2.5" /> Meta auto
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {channelLabel(c.channel)}
                            </span>
                          </td>
                          {accounts.length > 1 && (
                            <td className="px-4 py-3">
                              <span className="text-[11px] text-muted-foreground">
                                {c.account_name || c.account_id || '—'}
                              </span>
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <select
                              value={c.status}
                              onChange={(e) => updateStatus(c.id, e.target.value)}
                              className={`text-xs rounded border px-2 py-1 bg-muted ${statusBadge(c.status)}`}
                            >
                              {STATUSES.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-right text-foreground tabular-nums">
                            {formatCurrency(c.adspend)}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground tabular-nums">
                            {formatNumber(c.meta_leads || 0)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className="inline-flex items-center gap-1 text-foreground">
                              {formatNumber(c.funnel_leads || 0)}
                              {showGap && (
                                <span
                                  title={`Meta reporta ${c.meta_leads} pero en la app hay ${c.funnel_leads}. Revisa el tracking/UTM.`}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                            {cpm === null ? '—' : formatCurrency(cpm)}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                            {cpc === null ? '—' : formatCurrency(cpc)}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                            {ctr === null ? '—' : `${fmtNum(ctr)}%`}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                            {cpl === null ? '—' : formatCurrency(cpl)}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground tabular-nums">
                            {(c.followers || 0) > 0 ? formatNumber(c.followers || 0) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                            {(() => {
                              const cpf = div(c.adspend, c.followers || 0)
                              return cpf === null ? '—' : formatCurrency(cpf)
                            })()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isAccounted ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 className="w-3 h-3" /> Contabilizado ({period})
                              </span>
                            ) : (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                Pendiente
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              {!isMeta && (
                                <button
                                  onClick={() => openEdit(c)}
                                  title="Editar gasto/leads"
                                  className="p-1.5 rounded-md bg-muted text-foreground hover:bg-muted"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => postToExpenses(c)}
                                disabled={postingId === c.id}
                                title="Contabilizar en gastos"
                                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs bg-brand-600/20 text-brand-300 border border-brand-600/30 hover:bg-brand-600/30 disabled:opacity-50"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                                {postingId === c.id
                                  ? 'Guardando…'
                                  : isAccounted
                                    ? 'Actualizar gasto'
                                    : 'Contabilizar en gastos'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Usa <span className="text-muted-foreground">Editar</span> para ir actualizando el gasto acumulado,
              impresiones, clics y leads de cada campaña. Con{' '}
              <span className="text-muted-foreground">Contabilizar en gastos</span> el importe de &quot;Gasto real&quot;
              se registra automáticamente como un gasto de publicidad en Finanzas y se refleja en el P&amp;L del mes en
              curso; si vuelves a pulsarlo, actualiza el mismo gasto en vez de duplicarlo.
            </p>
          </>
        ))}

      {showTargets && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowTargets(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Objetivos de rendimiento</h3>
              <button onClick={() => setShowTargets(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Se usan para pintar en verde/ámbar/rojo los KPIs del embudo de ads. Deja vacío el que no quieras vigilar.
            </p>
            <div>
              <label className="text-xs text-muted-foreground">ROAS objetivo (mínimo, ej. 3 = 3x)</label>
              <input
                type="number"
                step="0.01"
                value={targetsForm.target_roas}
                onChange={(e) => setTargetsForm({ ...targetsForm, target_roas: e.target.value })}
                placeholder="Sin objetivo"
                className={cls}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">CAC objetivo (máximo, €)</label>
              <input
                type="number"
                step="0.01"
                value={targetsForm.target_cac}
                onChange={(e) => setTargetsForm({ ...targetsForm, target_cac: e.target.value })}
                placeholder="Sin objetivo"
                className={cls}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">CPL objetivo (máximo, €)</label>
              <input
                type="number"
                step="0.01"
                value={targetsForm.target_cpl}
                onChange={(e) => setTargetsForm({ ...targetsForm, target_cpl: e.target.value })}
                placeholder="Sin objetivo"
                className={cls}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowTargets(false)} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button
                onClick={saveTargets}
                disabled={savingTargets}
                className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
              >
                {savingTargets ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Actualizar {editing.name}</h3>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Gasto real acumulado (€)</label>
              <input
                type="number"
                step="0.01"
                value={qe.adspend}
                onChange={(e) => setQe({ ...qe, adspend: e.target.value })}
                placeholder="0.00"
                className={cls}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Impresiones</label>
                <input
                  type="number"
                  value={qe.impressions}
                  onChange={(e) => setQe({ ...qe, impressions: e.target.value })}
                  placeholder="0"
                  className={cls}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Clics</label>
                <input
                  type="number"
                  value={qe.clicks}
                  onChange={(e) => setQe({ ...qe, clicks: e.target.value })}
                  placeholder="0"
                  className={cls}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Leads</label>
                <input
                  type="number"
                  value={qe.leads_generated}
                  onChange={(e) => setQe({ ...qe, leads_generated: e.target.value })}
                  placeholder="0"
                  className={cls}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Esto solo actualiza los datos de la campaña. Para que el gasto entre en Finanzas/P&amp;L, usa después
              &quot;Contabilizar en gastos&quot;.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
              >
                {savingEdit ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowNew(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nueva campaña</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={nc.name}
              onChange={(e) => setNc({ ...nc, name: e.target.value })}
              placeholder="Nombre de la campaña"
              className={cls}
            />
            <div className="grid grid-cols-2 gap-3">
              <select value={nc.channel} onChange={(e) => setNc({ ...nc, channel: e.target.value })} className={cls}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select value={nc.type} onChange={(e) => setNc({ ...nc, type: e.target.value })} className={cls}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Fecha inicio</label>
                <input
                  type="date"
                  value={nc.start_date}
                  onChange={(e) => setNc({ ...nc, start_date: e.target.value })}
                  className={cls}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Fecha fin</label>
                <input
                  type="date"
                  value={nc.end_date}
                  onChange={(e) => setNc({ ...nc, end_date: e.target.value })}
                  className={cls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Presupuesto (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={nc.budget}
                  onChange={(e) => setNc({ ...nc, budget: e.target.value })}
                  placeholder="0.00"
                  className={cls}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Gasto real (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={nc.adspend}
                  onChange={(e) => setNc({ ...nc, adspend: e.target.value })}
                  placeholder="0.00"
                  className={cls}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Impresiones</label>
                <input
                  type="number"
                  value={nc.impressions}
                  onChange={(e) => setNc({ ...nc, impressions: e.target.value })}
                  placeholder="0"
                  className={cls}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Clics</label>
                <input
                  type="number"
                  value={nc.clicks}
                  onChange={(e) => setNc({ ...nc, clicks: e.target.value })}
                  placeholder="0"
                  className={cls}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Leads</label>
                <input
                  type="number"
                  value={nc.leads_generated}
                  onChange={(e) => setNc({ ...nc, leads_generated: e.target.value })}
                  placeholder="0"
                  className={cls}
                />
              </div>
            </div>
            <input
              value={nc.ad_source}
              onChange={(e) => setNc({ ...nc, ad_source: e.target.value })}
              placeholder="Fuente del anuncio (ad_source)"
              className={cls}
            />
            <textarea
              value={nc.notes}
              onChange={(e) => setNc({ ...nc, notes: e.target.value })}
              rows={2}
              placeholder="Notas"
              className={cls}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button onClick={create} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
