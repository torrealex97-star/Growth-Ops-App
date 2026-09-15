'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart3,
  CalendarCheck,
  Video,
  PhoneCall,
  ThumbsUp,
  HandCoins,
  Wallet,
  Trophy,
  Banknote,
  Undo2,
  Gauge,
  ArrowRight,
  ClipboardList,
  ListChecks,
} from 'lucide-react'
import { lastNMonths, monthLabel } from '@/lib/analytics'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { originLabel } from '@/lib/ads/funnel'
import { isAttended } from '@/lib/appointments/status'
import { countryISOForPhone, regionForISO } from '@/lib/phone'
import { useSesion } from '@/lib/tenant-context'

type MetricsAppointmentRow = {
  id: string
  status: string
  event_type: 'demo' | 'sales_call' | 'follow_up_call' | null
  offered: boolean | null
  result: string | null
  pipe_value: number | null
  appointment_datetime: string
  setter_id: string | null
  closer_id: string | null
  needs_followup: boolean | null
  utm_source: string | null
  utm_term: string | null
  contact_id: string | null
}

type MetricsSaleRow = {
  id: string
  gross_amount: number
  status: string
  sale_date: string
  closer_id: string | null
  setter_id: string | null
  appointment_id: string | null
}

type MetricsCollectionRow = {
  gross_amount: number
  commissionable_amount: number
  collected_at: string
}

type PersonRow = {
  id: string
  full_name: string
  roles?: { key?: string } | null
}

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ymOf(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  return dateStr.slice(0, 7)
}

function num(x: number | string | null | undefined) {
  return Number(x ?? 0)
}

function pct(curr: number, base: number): string {
  if (!base) return '—'
  return formatPercent((curr / base) * 100, 1)
}

function pctVal(curr: number, base: number): number | null {
  if (!base) return null
  return (curr / base) * 100
}

function ratio(value: number, base: number): string {
  if (!base) return '—'
  return formatCurrency(value / base)
}

const ACTIVE_APPT_STATUSES = ['scheduled', 'confirmed', 'show', 'completed', 'rescheduled']
const CANCELLED_APPT_STATUSES = ['cancelled', 'cancelled_admin', 'cancelled_lead']
// Programadas: citas agendadas que todavía faltan por hacerse (no confundir con el status
// 'reserva', que significa que el lead ya pagó la reserva/depósito).
const PROGRAMADA_APPT_STATUSES = ['scheduled', 'confirmed', 'rescheduled', 'seguimiento']

function KPICard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string
  value: string
  icon: React.ElementType
  description?: string
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-brand-400" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
    </div>
  )
}

function FunnelStep({
  label,
  value,
  pctFromPrev,
  icon: Icon,
  isLast,
}: {
  label: string
  value: string
  pctFromPrev: string | null
  icon: React.ElementType
  isLast?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-[130px] bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="w-4 h-4 text-brand-400" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </div>
      {!isLast && (
        <div className="flex flex-col items-center text-muted-foreground shrink-0">
          <ArrowRight className="w-5 h-5" />
          {pctFromPrev !== null && (
            <span className="text-xs text-muted-foreground mt-1 whitespace-nowrap">{pctFromPrev}</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function VentasMetricasPage() {
  const sesion = useSesion()
  const [loading, setLoading] = useState(true)
  const [appointments, setAppointments] = useState<MetricsAppointmentRow[]>([])
  const [sales, setSales] = useState<MetricsSaleRow[]>([])
  const [collections, setCollections] = useState<MetricsCollectionRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [ym, setYm] = useState(nowYm())
  const [personId, setPersonId] = useState<string>('all')
  const [myRole, setMyRole] = useState<string | null>(null)
  const [regionByContact, setRegionByContact] = useState<Map<string, string>>(new Map())

  // --- Filtro unificado de periodo (barra superior) ---
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const [apptRes, salesRes, collRes, usersRes, contactsRes] = await Promise.all([
        supabase
          .from('appointments')
          .select(
            'id, status, event_type, offered, result, pipe_value, appointment_datetime, setter_id, closer_id, needs_followup, utm_source, utm_term, contact_id'
          ),
        supabase.from('sales').select('id, gross_amount, status, sale_date, closer_id, setter_id, appointment_id'),
        supabase.from('collections').select('gross_amount, commissionable_amount, collected_at'),
        supabase.from('users').select('id, full_name, roles(key)').eq('is_active', true),
        supabase.from('contacts').select('id, phone'),
      ])
      if (!mounted) return
      setAppointments((apptRes.data as MetricsAppointmentRow[] | null) || [])
      setSales((salesRes.data as MetricsSaleRow[] | null) || [])
      setCollections((collRes.data as MetricsCollectionRow[] | null) || [])
      // Solo roles que realmente aparecen como closer_id/setter_id en agendas/ventas:
      // el selector mezclaba a TODO el equipo (csm, editor, manager...) con los cierres/agendas
      // reales, lo que ensuciaba el desglose por persona (bug: "en closer solo debe estar los
      // registrados como closer no más nadie").
      const SALES_ROLES = new Set(['closer', 'setter', 'cold_caller', 'admin'])
      setPeople(((usersRes.data as PersonRow[] | null) || []).filter((p) => SALES_ROLES.has(p.roles?.key ?? '')))
      // Región por contacto (LATAM/USA-Canadá/España/Europa) a partir del prefijo del teléfono,
      // para el desglose "agendas por región" que solo ve el director.
      const rMap = new Map<string, string>()
      for (const c of (contactsRes.data as { id: string; phone: string | null }[] | null) || []) {
        rMap.set(c.id, regionForISO(countryISOForPhone(c.phone)))
      }
      setRegionByContact(rMap)
      setMyRole(sesion?.rol ?? null)
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [sesion])

  const monthOptions = useMemo(() => lastNMonths(12, nowYm()).reverse(), [])

  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])

  const personAppointments = useMemo(
    () =>
      personId === 'all'
        ? appointments
        : appointments.filter((a) => a.setter_id === personId || a.closer_id === personId),
    [appointments, personId]
  )
  const personSales = useMemo(
    () => (personId === 'all' ? sales : sales.filter((s) => s.closer_id === personId || s.setter_id === personId)),
    [sales, personId]
  )

  // El selector de Mes (ym) y el filtro de Periodo (Hoy/Semana/Trimestre/Custom...) se
  // aplicaban ambos con AND: si el mes elegido no coincide con "hoy" (el preset de periodo
  // siempre se calcula sobre la fecha actual, ver getPeriodRange), la intersección quedaba
  // vacía en silencio, sin avisar. Con un preset de periodo activo, este manda solo; el
  // selector de Mes solo actúa cuando el periodo está en "Todo".
  const usingPeriodPreset = periodPreset !== 'all'
  const monthAppointments = useMemo(
    () =>
      personAppointments.filter(
        (a) => (usingPeriodPreset || ymOf(a.appointment_datetime) === ym) && inPeriod(a.appointment_datetime, range)
      ),
    [personAppointments, ym, range, usingPeriodPreset]
  )
  const monthSales = useMemo(
    () => personSales.filter((s) => (usingPeriodPreset || ymOf(s.sale_date) === ym) && inPeriod(s.sale_date, range)),
    [personSales, ym, range, usingPeriodPreset]
  )
  const monthCollections = useMemo(
    () =>
      collections.filter((c) => (usingPeriodPreset || ymOf(c.collected_at) === ym) && inPeriod(c.collected_at, range)),
    [collections, ym, range, usingPeriodPreset]
  )

  const eventTypeCoverage = useMemo(() => {
    if (monthAppointments.length === 0) return 0
    const withType = monthAppointments.filter((a) => !!a.event_type).length
    return (withType / monthAppointments.length) * 100
  }, [monthAppointments])

  const metrics = useMemo(() => {
    const demos = monthAppointments.filter((a) => a.event_type === 'demo')
    const salesCalls = monthAppointments.filter((a) => a.event_type === 'sales_call' || a.event_type === null)

    const activeAppts = monthAppointments.filter((a) => ACTIVE_APPT_STATUSES.includes(a.status))
    const pipeValue = activeAppts.reduce((acc, a) => acc + num(a.pipe_value), 0)

    const bookedDemos = demos.length
    const liveDemos = demos.filter((a) => isAttended(a.status)).length
    const cancelledDemos = demos.filter((a) => CANCELLED_APPT_STATUSES.includes(a.status)).length
    const goodDemos = demos.filter((a) => a.result === 'good_demo').length

    const bookedSalesCalls = salesCalls.length
    const liveSalesCalls = salesCalls.filter((a) => isAttended(a.status)).length
    const cancelledSalesCalls = salesCalls.filter((a) => CANCELLED_APPT_STATUSES.includes(a.status)).length

    const offers = monthAppointments.filter((a) => a.offered === true || a.result === 'offer_made').length
    const deposits = monthAppointments.filter((a) => a.result === 'deposit').length

    const closedSales = monthSales.filter((s) => s.status === 'active' || s.status === 'partial_refund')
    const closedByResult = monthAppointments.filter((a) => a.result === 'closed').length
    const closes = closedSales.length > 0 ? closedSales.length : closedByResult
    const closedValue = closedSales.reduce((acc, s) => acc + num(s.gross_amount), 0)

    // Renombrado a "Cobros comisionables" en la UI (Fase 5): esto NO es lo mismo que "Net Revenue"
    // de Finanzas/P&L (lib/finance/pnl.ts: Gross Revenue − Refunds − Discounts). Aquí es cash
    // collected del periodo sobre base comisionable (neto de fees/impuestos de la pasarela, no de
    // devoluciones — Refunds se muestra aparte como conteo, no se resta de esta cifra). Dos
    // pantallas llamando "Net Revenue" a números distintos era exactamente la confusión que esta
    // fase corrige — se mantiene el cálculo (es un dato de calidad de lead válido), se corrige el
    // nombre. Ver docs/METRICS.md.
    const netRevenue = monthCollections.reduce((acc, c) => acc + num(c.commissionable_amount || c.gross_amount), 0)

    const refunds = personSales.filter(
      (s) =>
        (usingPeriodPreset || ymOf(s.sale_date) === ym) &&
        inPeriod(s.sale_date, range) &&
        (s.status === 'refunded' || s.status === 'partial_refund' || s.status === 'chargeback')
    ).length

    const programadas = monthAppointments.filter((a) => PROGRAMADA_APPT_STATUSES.includes(a.status)).length
    const seguimientos = monthAppointments.filter((a) => a.needs_followup).length

    return {
      pipeValue,
      bookedDemos,
      liveDemos,
      cancelledDemos,
      goodDemos,
      bookedSalesCalls,
      liveSalesCalls,
      cancelledSalesCalls,
      offers,
      deposits,
      closes,
      closedValue,
      netRevenue,
      refunds,
      programadas,
      seguimientos,
    }
  }, [monthAppointments, monthSales, monthCollections, personSales, ym, range])

  // Ventas por fuente (Facebook/Meta, Setting IA, orgánico...) — cruzando la venta con la agenda
  // que la originó (sales.appointment_id -> appointments.utm_source/utm_term), mismo criterio que
  // el badge "Origen" de /${tenant}/crm/agendas.
  const apptById = useMemo(() => {
    const m = new Map<string, MetricsAppointmentRow>()
    for (const a of appointments) m.set(a.id, a)
    return m
  }, [appointments])

  const salesBySource = useMemo(() => {
    const rows = new Map<string, { count: number; revenue: number }>()
    for (const s of monthSales) {
      const appt = s.appointment_id ? apptById.get(s.appointment_id) : null
      const label = originLabel(appt?.utm_source ?? null, appt?.utm_term ?? null)
      const prev = rows.get(label) || { count: 0, revenue: 0 }
      prev.count += 1
      prev.revenue += num(s.gross_amount)
      rows.set(label, prev)
    }
    return Array.from(rows.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [monthSales, apptById])

  // Filtrado solo por periodo (sin restringir a una persona), para poder comparar a todo el
  // equipo a la vez en la tabla de abajo.
  const periodAppointments = useMemo(
    () =>
      appointments.filter(
        (a) => (usingPeriodPreset || ymOf(a.appointment_datetime) === ym) && inPeriod(a.appointment_datetime, range)
      ),
    [appointments, ym, range, usingPeriodPreset]
  )
  const periodSales = useMemo(
    () => sales.filter((s) => (usingPeriodPreset || ymOf(s.sale_date) === ym) && inPeriod(s.sale_date, range)),
    [sales, ym, range, usingPeriodPreset]
  )

  // Comparativa de equipo: métricas clave de cada persona en el mismo periodo, una al lado de
  // otra, para comparar rendimiento (en vez de tener que cambiar el selector uno a uno).
  const teamComparison = useMemo(() => {
    return people
      .map((p) => {
        const appts = periodAppointments.filter((a) => a.setter_id === p.id || a.closer_id === p.id)
        const salesCalls = appts.filter((a) => a.event_type === 'sales_call' || a.event_type === null)
        const bookedSC = salesCalls.length
        const liveSC = salesCalls.filter((a) => isAttended(a.status)).length
        const pSales = periodSales.filter((s) => s.closer_id === p.id || s.setter_id === p.id)
        const activeSales = pSales.filter((s) => s.status === 'active' || s.status === 'partial_refund')
        return {
          id: p.id,
          name: p.full_name,
          bookedSC,
          liveSC,
          showRate: pct(liveSC, bookedSC),
          closes: activeSales.length,
          closeRate: pct(activeSales.length, liveSC),
          revenue: activeSales.reduce((acc, s) => acc + num(s.gross_amount), 0),
        }
      })
      .filter((r) => r.bookedSC > 0 || r.closes > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [people, periodAppointments, periodSales])

  // Agendas por región (LATAM/USA-Canadá/España/Europa), inferida del prefijo del teléfono del
  // contacto. Solo la ve el director (petición explícita: "unicamente para verlo yo").
  const regionBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of monthAppointments) {
      const region = (a.contact_id && regionByContact.get(a.contact_id)) || 'Otro'
      map.set(region, (map.get(region) || 0) + 1)
    }
    const order = ['España', 'LATAM', 'USA/Canadá', 'Europa', 'Otro']
    return order.map((r) => ({ region: r, count: map.get(r) || 0 })).filter((r) => r.count > 0)
  }, [monthAppointments, regionByContact])

  const hasData = appointments.length > 0 || sales.length > 0 || collections.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-400" />
            <h1 className="text-2xl font-bold text-foreground">Métricas de ventas</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Embudo granular de Demos y Sales Calls, con tasas de conversión y ratios de valor
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            <option value="all">Toda la empresa</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          <select
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            disabled={usingPeriodPreset}
            title={usingPeriodPreset ? 'Desactivado: manda el filtro de Periodo de abajo' : undefined}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground disabled:opacity-50"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        members={people}
        member={personId}
        onMemberChange={setPersonId}
        hasActiveFilters={periodPreset !== 'all' || personId !== 'all'}
        onClear={() => {
          setPeriodPreset('all')
          setPersonId('all')
          setCustomFrom('')
          setCustomTo('')
        }}
      />

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse bg-card rounded-lg" />
            ))}
          </div>
          <div className="h-64 animate-pulse bg-card rounded-lg" />
        </div>
      ) : !hasData ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center text-muted-foreground">
          Sin datos todavía.
        </div>
      ) : (
        <>
          {eventTypeCoverage < 50 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
              Marca el tipo (Demo/Sales Call) en las agendas para separar ambos embudos. Actualmente solo el{' '}
              {formatPercent(eventTypeCoverage, 0)} de las citas del mes tienen event_type definido (las citas sin tipo
              se cuentan como Sales Call).
            </div>
          )}

          {/* Volúmenes */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Volúmenes — {monthLabel(ym)}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Pipe Value"
                value={formatCurrency(metrics.pipeValue)}
                icon={Gauge}
                description="valor en citas activas"
              />
              <KPICard
                title="Programadas"
                value={String(metrics.programadas)}
                icon={ClipboardList}
                description="citas agendadas sin resolver"
              />
              <KPICard
                title="Seguimientos"
                value={String(metrics.seguimientos)}
                icon={ListChecks}
                description="agendas marcadas en seguimiento"
              />
              <KPICard title="Booked Demos" value={String(metrics.bookedDemos)} icon={CalendarCheck} />
              <KPICard
                title="Live Demos"
                value={String(metrics.liveDemos)}
                icon={Video}
                description="show / completed"
              />
              <KPICard
                title="Good Demos"
                value={String(metrics.goodDemos)}
                icon={ThumbsUp}
                description="result = good_demo"
              />
              <KPICard title="Sales Calls Booked" value={String(metrics.bookedSalesCalls)} icon={CalendarCheck} />
              <KPICard
                title="Live Sales Calls"
                value={String(metrics.liveSalesCalls)}
                icon={PhoneCall}
                description="show / completed"
              />
              <KPICard
                title="Offers"
                value={String(metrics.offers)}
                icon={HandCoins}
                description="offered = true o offer_made"
              />
              <KPICard title="Deposits" value={String(metrics.deposits)} icon={Wallet} description="result = deposit" />
              <KPICard title="Closes" value={String(metrics.closes)} icon={Trophy} description="ventas del periodo" />
              <KPICard
                title="Cobros comisionables"
                value={formatCurrency(metrics.netRevenue)}
                icon={Banknote}
                description="cobros del periodo, base comisionable (no es el Net Revenue de Finanzas)"
              />
              <KPICard title="Refunds" value={String(metrics.refunds)} icon={Undo2} />
            </div>
          </div>

          {/* Tasas */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Tasas de conversión</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="% Show Rate (D)"
                value={pct(metrics.liveDemos, metrics.bookedDemos)}
                icon={Video}
                description="Live / Booked Demos"
              />
              <KPICard
                title="% Cancel (D)"
                value={pct(metrics.cancelledDemos, metrics.bookedDemos)}
                icon={Undo2}
                description="cancelled / Booked Demos"
              />
              <KPICard
                title="% Live(D)→(SC)"
                value={pct(metrics.liveSalesCalls, metrics.liveDemos)}
                icon={ArrowRight}
                description="Live Sales Calls / Live Demos"
              />
              <KPICard
                title="% Show Rate (SC)"
                value={pct(metrics.liveSalesCalls, metrics.bookedSalesCalls)}
                icon={PhoneCall}
                description="Live / Booked Sales Calls"
              />
              <KPICard
                title="% Cancel (SC)"
                value={pct(metrics.cancelledSalesCalls, metrics.bookedSalesCalls)}
                icon={Undo2}
                description="cancelled / Booked Sales Calls"
              />
              <KPICard
                title="% Offer/Close"
                value={pct(metrics.closes, metrics.offers)}
                icon={Trophy}
                description="Closes / Offers"
              />
              <KPICard
                title="% Live(SC)/Close"
                value={pct(metrics.closes, metrics.liveSalesCalls)}
                icon={Trophy}
                description="Closes / Live Sales Calls"
              />
              <KPICard
                title="% Booked(SC)/Close"
                value={pct(metrics.closes, metrics.bookedSalesCalls)}
                icon={Trophy}
                description="Closes / Booked Sales Calls"
              />
              <KPICard
                title="% Pipe Closed"
                value={pct(metrics.closedValue, metrics.pipeValue)}
                icon={Gauge}
                description="valor cerrado / Pipe Value"
              />
              <KPICard
                title="Cobros/LSC"
                value={ratio(metrics.netRevenue, metrics.liveSalesCalls)}
                icon={Banknote}
                description="Cobros comisionables / Live Sales Calls"
              />
              <KPICard
                title="Cobros/BSC"
                value={ratio(metrics.netRevenue, metrics.bookedSalesCalls)}
                icon={Banknote}
                description="Cobros comisionables / Booked Sales Calls"
              />
            </div>
          </div>

          {/* Embudo visual */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Embudo — Sales Calls</h2>
            <div className="flex flex-wrap items-center gap-2">
              <FunnelStep
                label="Booked"
                value={String(metrics.bookedSalesCalls)}
                pctFromPrev={null}
                icon={CalendarCheck}
              />
              <FunnelStep
                label="Live"
                value={String(metrics.liveSalesCalls)}
                pctFromPrev={
                  pctVal(metrics.liveSalesCalls, metrics.bookedSalesCalls) !== null
                    ? `${formatPercent(pctVal(metrics.liveSalesCalls, metrics.bookedSalesCalls)!, 1)}`
                    : null
                }
                icon={PhoneCall}
              />
              <FunnelStep
                label="Offer"
                value={String(metrics.offers)}
                pctFromPrev={
                  pctVal(metrics.offers, metrics.liveSalesCalls) !== null
                    ? `${formatPercent(pctVal(metrics.offers, metrics.liveSalesCalls)!, 1)}`
                    : null
                }
                icon={HandCoins}
              />
              <FunnelStep
                label="Close"
                value={String(metrics.closes)}
                pctFromPrev={
                  pctVal(metrics.closes, metrics.offers) !== null
                    ? `${formatPercent(pctVal(metrics.closes, metrics.offers)!, 1)}`
                    : null
                }
                icon={Trophy}
                isLast
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Conversión global Booked → Close: {pct(metrics.closes, metrics.bookedSalesCalls)}
            </p>
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Embudo — Demos</h2>
            <div className="flex flex-wrap items-center gap-2">
              <FunnelStep label="Booked" value={String(metrics.bookedDemos)} pctFromPrev={null} icon={CalendarCheck} />
              <FunnelStep
                label="Live"
                value={String(metrics.liveDemos)}
                pctFromPrev={
                  pctVal(metrics.liveDemos, metrics.bookedDemos) !== null
                    ? `${formatPercent(pctVal(metrics.liveDemos, metrics.bookedDemos)!, 1)}`
                    : null
                }
                icon={Video}
              />
              <FunnelStep
                label="Good Demo"
                value={String(metrics.goodDemos)}
                pctFromPrev={
                  pctVal(metrics.goodDemos, metrics.liveDemos) !== null
                    ? `${formatPercent(pctVal(metrics.goodDemos, metrics.liveDemos)!, 1)}`
                    : null
                }
                icon={ThumbsUp}
                isLast
              />
            </div>
          </div>

          {/* Ventas por fuente */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Ventas por fuente — {monthLabel(ym)}
            </h2>
            {salesBySource.length === 0 ? (
              <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
                Sin ventas en este periodo.
              </div>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Fuente</th>
                      <th className="text-right px-4 py-2 font-medium">Ventas</th>
                      <th className="text-right px-4 py-2 font-medium">Facturación</th>
                      <th className="text-right px-4 py-2 font-medium">% del total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesBySource.map((r) => (
                      <tr key={r.label} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 text-foreground">{r.label}</td>
                        <td className="px-4 py-2 text-right text-foreground">{r.count}</td>
                        <td className="px-4 py-2 text-right text-foreground">{formatCurrency(r.revenue)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {pct(r.revenue, metrics.closedValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Fuente = utm_source/utm_term de la agenda que originó la venta. Ventas sin agenda enlazada o sin UTM
              cuentan como &quot;Directo/Sin UTM&quot;.
            </p>
          </div>

          {/* Comparativa de equipo: varias personas a la vez, mismo periodo */}
          {teamComparison.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                Comparativa de equipo — {usingPeriodPreset ? 'periodo seleccionado' : monthLabel(ym)}
              </h2>
              <div className="bg-card border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Persona</th>
                      <th className="text-right px-4 py-2 font-medium">SC Booked</th>
                      <th className="text-right px-4 py-2 font-medium">SC Live</th>
                      <th className="text-right px-4 py-2 font-medium">Show Rate</th>
                      <th className="text-right px-4 py-2 font-medium">Closes</th>
                      <th className="text-right px-4 py-2 font-medium">Close Rate</th>
                      <th className="text-right px-4 py-2 font-medium">Facturación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamComparison.map((r) => (
                      <tr key={r.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 text-foreground font-medium">{r.name}</td>
                        <td className="px-4 py-2 text-right text-foreground">{r.bookedSC}</td>
                        <td className="px-4 py-2 text-right text-foreground">{r.liveSC}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{r.showRate}</td>
                        <td className="px-4 py-2 text-right text-foreground">{r.closes}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{r.closeRate}</td>
                        <td className="px-4 py-2 text-right text-foreground">{formatCurrency(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Agendas por región: solo director, petición explícita de privacidad de este dato */}
          {myRole === 'director' && regionBreakdown.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                Agendas por región — {monthLabel(ym)}{' '}
                <span className="normal-case text-muted-foreground/70">(solo visible para ti)</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {regionBreakdown.map((r) => (
                  <KPICard key={r.region} title={r.region} value={String(r.count)} icon={BarChart3} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Región inferida del prefijo internacional del teléfono del contacto (no es 100% exacta: números sin
                prefijo o con prefijo compartido cuentan como &quot;Otro&quot;).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
