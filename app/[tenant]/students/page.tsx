'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { GraduationCap, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { useTenant } from '@/lib/tenant-context'

type EngagementScore = 'bajo' | 'medio' | 'alto'
type PromiseFulfilled = 'si' | 'no' | 'en_proceso'

const ENGAGEMENT: { value: EngagementScore; label: string; color: string }[] = [
  { value: 'bajo', label: 'Bajo', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { value: 'medio', label: 'Medio', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'alto', label: 'Alto', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
]
const engagementMeta = (s: string | null) => ENGAGEMENT.find((x) => x.value === s) ?? null

const PROMISE: { value: PromiseFulfilled; label: string; color: string }[] = [
  { value: 'si', label: 'Sí', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'en_proceso', label: 'En proceso', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'no', label: 'No', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
]
const promiseMeta = (s: string | null) => PROMISE.find((x) => x.value === s) ?? null

type StudentContact = {
  id: string
  full_name: string
  email: string | null
  engagement_score: EngagementScore | null
  ttfv_date: string | null
  nps: number | null
  promise_fulfilled: PromiseFulfilled | null
}

type StudentRow = {
  id: string
  sale_date: string
  gross_amount: number
  onboarding_date: string | null
  onboarding_scheduled_at: string | null
  onboarding_session_at: string | null
  first_coaching_date: string | null
  graduation_date: string | null
  status: string
  contacts: StudentContact | null
  products: { name: string; duration_months: number | null } | null
  payment_plans: { method: string | null; name: string | null } | null
  // Tracking del contrato de alumno (fusionado tras cargar): accesos + click en landing.
  accesos_enviados_at: string | null
  accesos_abiertos_at: string | null
  signed_pdf_url: string | null
  course_access_granted_at: string | null
  course_access_revoked_at: string | null
}

type RenewalStatus = 'ok' | 'proxima' | 'vencido' | 'sin_dato'

type ProgramProgress = {
  startDate: Date | null
  currentMonth: number | null
  totalMonths: number | null
  endDate: Date | null
  renewalStatus: RenewalStatus
  daysToEnd: number | null
}

function computeProgress(row: StudentRow): ProgramProgress {
  const startStr = row.onboarding_date || row.sale_date
  const totalMonths = row.products?.duration_months ?? null

  if (!startStr) {
    return { startDate: null, currentMonth: null, totalMonths, endDate: null, renewalStatus: 'sin_dato', daysToEnd: null }
  }

  const startDate = new Date(startStr)
  if (isNaN(startDate.getTime())) {
    return { startDate: null, currentMonth: null, totalMonths, endDate: null, renewalStatus: 'sin_dato', daysToEnd: null }
  }

  const now = new Date()
  const monthsElapsed =
    (now.getFullYear() - startDate.getFullYear()) * 12 +
    (now.getMonth() - startDate.getMonth()) +
    (now.getDate() >= startDate.getDate() ? 0 : -1)
  const currentMonth = Math.max(1, monthsElapsed + 1)

  if (!totalMonths) {
    return { startDate, currentMonth, totalMonths: null, endDate: null, renewalStatus: 'sin_dato', daysToEnd: null }
  }

  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + totalMonths)

  const msPerDay = 1000 * 60 * 60 * 24
  const daysToEnd = Math.round((endDate.getTime() - now.getTime()) / msPerDay)

  let renewalStatus: RenewalStatus = 'ok'
  if (daysToEnd <= 0) renewalStatus = 'vencido'
  else if (daysToEnd <= 30) renewalStatus = 'proxima'

  return { startDate, currentMonth, totalMonths, endDate, renewalStatus, daysToEnd }
}

type JourneyStage = 'graduado' | 'coaching' | 'onboarded' | 'agendado' | 'pendiente'

const JOURNEY_META: Record<JourneyStage, { label: string; color: string }> = {
  graduado: { label: 'Graduado', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  coaching: { label: 'En Coaching', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  onboarded: { label: 'Onboarded', color: 'bg-brand-500/20 text-brand-400 border-brand-500/30' },
  agendado: { label: 'Onboarding agendado', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  pendiente: { label: 'Pendiente Onboarding', color: 'bg-zinc-500/20 text-foreground border-border/30' },
}

function journeyStage(row: StudentRow): JourneyStage {
  if (row.graduation_date) return 'graduado'
  if (row.first_coaching_date) return 'coaching'
  if (row.onboarding_date) return 'onboarded'
  if (row.onboarding_scheduled_at) return 'agendado'
  return 'pendiente'
}

// Vistas rápidas del funnel de onboarding (filtros del pipeline).
type OnbView = 'all' | 'sin_click' | 'click' | 'agendado' | 'onboarded'

function matchesOnbView(row: StudentRow, view: OnbView): boolean {
  switch (view) {
    case 'all': return true
    // Accesos enviados pero SIN abrir la landing y sin agendar → hay que perseguirlos.
    case 'sin_click': return !!row.accesos_enviados_at && !row.accesos_abiertos_at && !row.onboarding_scheduled_at && !row.onboarding_date
    case 'click': return !!row.accesos_abiertos_at
    case 'agendado': return !!row.onboarding_scheduled_at
    case 'onboarded': return !!row.onboarding_date
  }
}

const cls = 'text-xs rounded-md border border-border bg-muted text-foreground px-2 py-1 focus:outline-none focus:border-brand-500'

const FUNNEL_TONE: Record<string, string> = {
  muted: 'text-foreground',
  sky: 'text-sky-400',
  amber: 'text-amber-400',
  brand: 'text-brand-400',
}

function FunnelStat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${FUNNEL_TONE[tone] ?? 'text-foreground'}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  )
}

// Punto de estado compacto para la columna Onboarding de la tabla.
function TrackDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
        on ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
      {label}
    </span>
  )
}

export default function StudentsPage() {
  const tenant = useTenant()
  const [rows, setRows] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<EngagementScore | 'all'>('all')
  const [onbView, setOnbView] = useState<OnbView>('all')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      // Cargamos ventas y el tracking de contratos de alumno en paralelo.
      const [salesRes, contractsRes] = await Promise.all([
        supabase
          .from('sales')
          .select('id, sale_date, gross_amount, onboarding_date, onboarding_scheduled_at, onboarding_session_at, first_coaching_date, graduation_date, status, course_access_granted_at, course_access_revoked_at, contacts(id, full_name, email, engagement_score, ttfv_date, nps, promise_fulfilled), products(name, duration_months), payment_plans(method, name)')
          .order('sale_date', { ascending: false }),
        supabase
          .from('contracts')
          .select('sale_id, contact_id, accesos_enviados_at, accesos_abiertos_at, signed_at, signed_pdf_url')
          .eq('kind', 'venta')
          .neq('contract_party', 'tomador')
          .eq('is_reservation', false),
      ])
      if (!mounted) return
      if (salesRes.error) {
        toast.error('No se pudieron cargar los alumnos', { description: salesRes.error.message })
      }
      if (contractsRes.error) {
        toast.error('No se pudo cargar el tracking de contratos', { description: contractsRes.error.message })
      }
      // Índice del tracking del contrato de alumno por sale_id (y por contact_id como fallback).
      type CTrack = { sale_id: string | null; contact_id: string | null; accesos_enviados_at: string | null; accesos_abiertos_at: string | null; signed_at: string | null; signed_pdf_url: string | null }
      const bySale = new Map<string, CTrack>()
      const byContact = new Map<string, CTrack>()
      for (const c of ((contractsRes.data as CTrack[]) || [])) {
        if (c.sale_id && !bySale.has(c.sale_id)) bySale.set(c.sale_id, c)
        if (c.contact_id && !byContact.has(c.contact_id)) byContact.set(c.contact_id, c)
      }
      // Excluye las reservas (payment_plans.method === 'reserva'): no son alumnos todavía
      const allRows = (salesRes.data as unknown as StudentRow[]) || []
      const merged = allRows
        .filter((r) => r.payment_plans?.method !== 'reserva')
        .map((r) => {
          const t = bySale.get(r.id) || (r.contacts?.id ? byContact.get(r.contacts.id) : undefined)
          return {
            ...r,
            accesos_enviados_at: t?.accesos_enviados_at ?? null,
            accesos_abiertos_at: t?.accesos_abiertos_at ?? null,
            signed_pdf_url: t?.signed_pdf_url ?? null,
          }
        })
      setRows(merged)
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [])

  const updateContact = async (contactId: string, patch: Partial<Pick<StudentContact, 'engagement_score' | 'nps' | 'promise_fulfilled' | 'ttfv_date'>>) => {
    setRows((prev) => prev.map((r) => (r.contacts?.id === contactId ? { ...r, contacts: { ...r.contacts!, ...patch } } : r)))
    // Vía API con service-role: contacts solo tiene política RLS de SELECT, un UPDATE directo
    // desde el cliente se bloqueaba en silencio (0 filas, sin error).
    const res = await fetch(`/api/${tenant}/evergreen/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error('No se pudo actualizar el contacto', { description: d?.error })
    }
  }

  const [accessSavingId, setAccessSavingId] = useState<string | null>(null)
  const setCourseAccess = async (saleId: string, action: 'grant' | 'revoke') => {
    setAccessSavingId(saleId)
    const now = new Date().toISOString()
    setRows((prev) => prev.map((r) => (r.id === saleId
      ? { ...r, course_access_granted_at: action === 'grant' ? now : r.course_access_granted_at, course_access_revoked_at: action === 'revoke' ? now : null }
      : r)))
    const res = await fetch(`/api/${tenant}/evergreen/students/course-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId, action }),
    })
    const d = await res.json().catch(() => ({}))
    setAccessSavingId(null)
    if (!res.ok) {
      toast.error(action === 'grant' ? 'No se pudo conceder el acceso' : 'No se pudo revocar el acceso', { description: d?.error })
      return
    }
    if (d.webhookConfigured === false) {
      toast.warning('Registrado, pero sin automatización conectada', {
        description: 'Falta configurar GHL_ONBOARDING_WEBHOOK_URL para que GHL ejecute el acceso real en el curso.',
      })
    } else if (d.webhookResult && !d.webhookResult.ok) {
      toast.warning('Registrado, pero la automatización de GHL no respondió OK', { description: d.webhookResult.error })
    } else {
      toast.success(action === 'grant' ? 'Acceso concedido' : 'Acceso revocado')
    }
  }

  const updateSale = async (saleId: string, patch: Partial<Pick<StudentRow, 'onboarding_date' | 'first_coaching_date' | 'graduation_date'>>) => {
    setRows((prev) => prev.map((r) => (r.id === saleId ? { ...r, ...patch } : r)))
    // Vía API con service-role: sales solo tiene políticas RLS de SELECT e INSERT — NINGÚN rol
    // puede hacer UPDATE directo desde el cliente (0 filas, sin error). Esto hacía que marcar el
    // onboarding/coaching/graduación pareciera guardarse pero nunca persistiera de verdad.
    const res = await fetch(`/api/${tenant}/evergreen/sales/${saleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error('No se pudo actualizar la matrícula', { description: d?.error })
    }
  }

  const periodRows = useMemo(
    () => rows.filter((r) => inPeriod(r.sale_date, range)),
    [rows, range]
  )

  const filtered = useMemo(() => {
    let base = filter === 'all' ? periodRows : periodRows.filter((r) => r.contacts?.engagement_score === filter)
    if (onbView !== 'all') base = base.filter((r) => matchesOnbView(r, onbView))
    const nq = normalizeText(q.trim())
    if (!nq) return base
    return base.filter((r) =>
      normalizeText(r.contacts?.full_name || '').includes(nq) ||
      normalizeText(r.contacts?.email || '').includes(nq) ||
      normalizeText(r.products?.name || '').includes(nq)
    )
  }, [periodRows, filter, onbView, q])

  // Funnel de onboarding: accesos enviados → click en landing → agendado → onboarded.
  const funnel = useMemo(() => {
    const enviados = periodRows.filter((r) => r.accesos_enviados_at).length
    const clicks = periodRows.filter((r) => r.accesos_abiertos_at).length
    const agendados = periodRows.filter((r) => r.onboarding_scheduled_at).length
    const onboarded = periodRows.filter((r) => r.onboarding_date).length
    const sinClick = periodRows.filter((r) => matchesOnbView(r, 'sin_click')).length
    const pct = (n: number, base: number) => (base ? Math.round((n / base) * 100) : 0)
    return {
      enviados, clicks, agendados, onboarded, sinClick,
      clickPct: pct(clicks, enviados),
      agendadoPct: pct(agendados, enviados),
      onboardedPct: pct(onboarded, agendados),
    }
  }, [periodRows])

  const progressById = useMemo(() => {
    const map = new Map<string, ProgramProgress>()
    periodRows.forEach((r) => map.set(r.id, computeProgress(r)))
    return map
  }, [periodRows])

  const renewalsCount = useMemo(
    () =>
      periodRows.filter((r) => {
        const p = progressById.get(r.id)
        return p?.renewalStatus === 'proxima' || p?.renewalStatus === 'vencido'
      }).length,
    [periodRows, progressById]
  )

  const kpis = useMemo(() => {
    const total = periodRows.length
    const onboarded = periodRows.filter((r) => r.onboarding_date).length
    const graduados = periodRows.filter((r) => r.graduation_date).length
    const npsValues = periodRows.map((r) => r.contacts?.nps).filter((n): n is number => n !== null && n !== undefined)
    const npsAvg = npsValues.length ? npsValues.reduce((a, b) => a + b, 0) / npsValues.length : null
    const engagementCounts: Record<EngagementScore, number> = { bajo: 0, medio: 0, alto: 0 }
    periodRows.forEach((r) => {
      const e = r.contacts?.engagement_score
      if (e) engagementCounts[e]++
    })
    return {
      total,
      onboardedPct: total ? Math.round((onboarded / total) * 100) : 0,
      graduadosPct: total ? Math.round((graduados / total) * 100) : 0,
      npsAvg,
      engagementCounts,
    }
  }, [periodRows])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-brand-400" /> Alumnos
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Journey del alumno — onboarding, coaching, graduación, engagement</p>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onClear={() => { setPeriodPreset('all'); setCustomFrom(''); setCustomTo(''); setFilter('all'); setOnbView('all'); setQ('') }}
        hasActiveFilters={periodPreset !== 'all' || filter !== 'all' || onbView !== 'all' || q.trim() !== ''}
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Total alumnos</p>
          <p className="text-2xl font-bold text-foreground mt-1">{kpis.total}</p>
        </div>
        <div className="bg-card border border-amber-500/30 rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Próximos a renovar</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{renewalsCount}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">% Onboarded</p>
          <p className="text-2xl font-bold text-brand-400 mt-1">{kpis.onboardedPct}%</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">% Graduados</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{kpis.graduadosPct}%</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">NPS medio</p>
          <p className="text-2xl font-bold text-foreground mt-1">{kpis.npsAvg !== null ? kpis.npsAvg.toFixed(1) : '—'}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Engagement</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-red-400">B {kpis.engagementCounts.bajo}</span>
            <span className="text-amber-400">M {kpis.engagementCounts.medio}</span>
            <span className="text-emerald-400">A {kpis.engagementCounts.alto}</span>
          </div>
        </div>
      </div>

      {/* Funnel de onboarding */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">Funnel de onboarding</p>
          {funnel.sinClick > 0 && (
            <button
              onClick={() => setOnbView(onbView === 'sin_click' ? 'all' : 'sin_click')}
              className={`text-xs px-2 py-1 rounded-md border ${onbView === 'sin_click' ? 'bg-red-600 text-white border-red-600' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}
            >
              {funnel.sinClick} sin abrir accesos — perseguir
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FunnelStat label="Accesos enviados" value={funnel.enviados} sub="base del funnel" tone="muted" />
          <FunnelStat label="Han hecho click" value={funnel.clicks} sub={`${funnel.clickPct}% de enviados`} tone="sky" />
          <FunnelStat label="Onboarding agendado" value={funnel.agendados} sub={`${funnel.agendadoPct}% de enviados`} tone="amber" />
          <FunnelStat label="Onboarded" value={funnel.onboarded} sub={`${funnel.onboardedPct}% de agendados`} tone="brand" />
        </div>
      </div>

      <SearchBox value={q} onChange={setQ} placeholder="Buscar alumno por nombre, email o programa..." className="w-full sm:w-96" />

      {/* Filtros del funnel de onboarding */}
      <div className="flex flex-wrap gap-2">
        {([
          { v: 'all', label: 'Todos', n: periodRows.length },
          { v: 'sin_click', label: 'Sin abrir accesos', n: funnel.sinClick },
          { v: 'click', label: 'Han hecho click', n: funnel.clicks },
          { v: 'agendado', label: 'Onboarding agendado', n: funnel.agendados },
          { v: 'onboarded', label: 'Onboarded', n: funnel.onboarded },
        ] as { v: OnbView; label: string; n: number }[]).map((o) => (
          <button
            key={o.v}
            onClick={() => setOnbView(o.v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${onbView === o.v ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}
          >
            {o.label} ({o.n})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}>
          Todos ({periodRows.length})
        </button>
        {ENGAGEMENT.map((e) => (
          <button key={e.value} onClick={() => setFilter(e.value)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === e.value ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}>
            {e.label} ({kpis.engagementCounts[e.value]})
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left font-medium p-3">Alumno</th>
              <th className="text-left font-medium p-3">Programa</th>
              <th className="text-right font-medium p-3">Importe</th>
              <th className="text-left font-medium p-3">Journey</th>
              <th className="text-left font-medium p-3">Onboarding</th>
              <th className="text-left font-medium p-3">Inicio</th>
              <th className="text-left font-medium p-3">Progreso</th>
              <th className="text-left font-medium p-3">Fin</th>
              <th className="text-left font-medium p-3">Engagement</th>
              <th className="text-center font-medium p-3">NPS</th>
              <th className="text-left font-medium p-3">Promesa</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">Cargando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">Sin alumnos.</td></tr>
            ) : filtered.map((r) => {
              const stage = journeyStage(r)
              const isOpen = expanded === r.id
              const contact = r.contacts
              const progress = progressById.get(r.id)
              return (
                <>
                  <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-card/50">
                    <td className="p-3">
                      <div className="text-foreground">{contact?.full_name ?? '—'}</div>
                      {contact?.email && <div className="text-xs text-muted-foreground">{contact.email}</div>}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.products?.name ?? '—'}</td>
                    <td className="p-3 text-right text-foreground">{formatCurrency(r.gross_amount)}</td>
                    <td className="p-3">
                      <span className={`inline-block text-xs px-2 py-1 rounded-md border ${JOURNEY_META[stage].color}`}>
                        {JOURNEY_META[stage].label}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <TrackDot on={!!r.accesos_enviados_at} label="Enviado" />
                        <TrackDot on={!!r.accesos_abiertos_at} label="Click" />
                        <TrackDot on={!!r.onboarding_scheduled_at} label="Agenda" />
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {progress?.startDate ? formatDate(progress.startDate.toISOString()) : '—'}
                    </td>
                    <td className="p-3">
                      {progress?.totalMonths && progress.currentMonth ? (
                        <div className="min-w-[110px]">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>Mes {Math.min(progress.currentMonth, progress.totalMonths)} de {progress.totalMonths}</span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500"
                              style={{ width: `${Math.min(100, Math.round((progress.currentMonth / progress.totalMonths) * 100))}%` }}
                            />
                          </div>
                          {(progress.renewalStatus === 'proxima' || progress.renewalStatus === 'vencido') && (
                            <span
                              className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${
                                progress.renewalStatus === 'vencido'
                                  ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              }`}
                            >
                              {progress.renewalStatus === 'vencido' ? 'Vencido' : 'Renovación próxima'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {progress?.endDate ? formatDate(progress.endDate.toISOString()) : '—'}
                    </td>
                    <td className="p-3">
                      <select
                        value={contact?.engagement_score || ''}
                        onChange={(e) => contact && updateContact(contact.id, { engagement_score: (e.target.value || null) as EngagementScore | null })}
                        className={`${cls} ${contact?.engagement_score ? engagementMeta(contact.engagement_score)?.color : ''}`}
                      >
                        <option value="" className="bg-card">—</option>
                        {ENGAGEMENT.map((e) => <option key={e.value} value={e.value} className="bg-card text-foreground">{e.label}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={contact?.nps ?? ''}
                        onChange={(e) => contact && updateContact(contact.id, { nps: e.target.value === '' ? null : Number(e.target.value) })}
                        className={`${cls} w-14 text-center`}
                      />
                    </td>
                    <td className="p-3">
                      <select
                        value={contact?.promise_fulfilled || ''}
                        onChange={(e) => contact && updateContact(contact.id, { promise_fulfilled: (e.target.value || null) as PromiseFulfilled | null })}
                        className={`${cls} ${contact?.promise_fulfilled ? promiseMeta(contact.promise_fulfilled)?.color : ''}`}
                      >
                        <option value="" className="bg-card">—</option>
                        {PROMISE.map((p) => <option key={p.value} value={p.value} className="bg-card text-foreground">{p.label}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-right">
                      <button onClick={() => setExpanded(isOpen ? null : r.id)} className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1 text-xs">
                        Detalle {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-card/30 border-b border-border/50">
                      <td colSpan={12} className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Onboarding</label>
                            <input
                              type="date"
                              value={r.onboarding_date || ''}
                              onChange={(e) => updateSale(r.id, { onboarding_date: e.target.value || null })}
                              className={`${cls} w-full`}
                            />
                            {r.onboarding_scheduled_at && (
                              <p className="text-[11px] text-amber-400 mt-1">
                                Agendó onboarding{r.onboarding_session_at
                                  ? ` · sesión ${new Date(r.onboarding_session_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                                  : ''}
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">1ª Coaching</label>
                            <input
                              type="date"
                              value={r.first_coaching_date || ''}
                              onChange={(e) => updateSale(r.id, { first_coaching_date: e.target.value || null })}
                              className={`${cls} w-full`}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Graduación</label>
                            <input
                              type="date"
                              value={r.graduation_date || ''}
                              onChange={(e) => updateSale(r.id, { graduation_date: e.target.value || null })}
                              className={`${cls} w-full`}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">TTFV (contacto)</label>
                            <input
                              type="date"
                              value={contact?.ttfv_date || ''}
                              onChange={(e) => contact && updateContact(contact.id, { ttfv_date: e.target.value || null })}
                              className={`${cls} w-full`}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-border/50">
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Contrato firmado</label>
                            {r.signed_pdf_url ? (
                              <a href={r.signed_pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-400 hover:text-brand-300 underline">
                                Ver contrato firmado
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin contrato firmado</span>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Acceso al curso (GHL)</label>
                            {r.course_access_revoked_at && (!r.course_access_granted_at || r.course_access_revoked_at > r.course_access_granted_at) ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-400">Revocado {formatDate(r.course_access_revoked_at)}</span>
                                <button
                                  disabled={accessSavingId === r.id}
                                  onClick={() => setCourseAccess(r.id, 'grant')}
                                  className="text-xs px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                  Conceder acceso
                                </button>
                              </div>
                            ) : r.course_access_granted_at ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-emerald-400">Concedido {formatDate(r.course_access_granted_at)}</span>
                                <button
                                  disabled={accessSavingId === r.id}
                                  onClick={() => setCourseAccess(r.id, 'revoke')}
                                  className="text-xs px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                                >
                                  Revocar acceso
                                </button>
                              </div>
                            ) : (
                              <button
                                disabled={accessSavingId === r.id}
                                onClick={() => setCourseAccess(r.id, 'grant')}
                                className="text-xs px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                              >
                                Conceder acceso
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-3">Fecha de venta: {formatDate(r.sale_date)}</div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
