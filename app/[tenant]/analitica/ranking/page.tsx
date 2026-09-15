'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Gauge,
  Users,
  PhoneCall,
  CalendarCheck,
  HandCoins,
  Trophy,
  Clock,
  Timer,
  Target as TargetIcon,
} from 'lucide-react'
import {
  teamRanking,
  setterAgendaStats,
  targetCurrentValue,
  type SaleRow,
  type AppointmentRow,
  type UserRow,
  type CollectionRow,
} from '@/lib/analytics'
import { formatCurrency } from '@/lib/utils'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import type { Target } from '@/lib/types/database'
import { CONTACTED_LEAD_STATUSES } from '@/lib/lead-status'
import { isAttended, isNoShow } from '@/lib/appointments/status'

type ContactRow = {
  id: string
  created_at: string
  first_contact_at: string | null
  lead_status: string
}

type PipelineAppointmentRow = AppointmentRow & {
  id: string
  result: string | null
  offered: boolean | null
  contact_id: string | null
  triager_id: string | null
  cold_caller_id: string | null
}

type UserWithRoleRow = {
  id: string
  full_name: string
  roles: { key: string } | null
}

type RoleRankRow = {
  userId: string
  name: string
  total: number
  qualified: number
  qualifiedRate: number
  noShows: number
  noShowRate: number
}

function roleRanking(
  appointments: PipelineAppointmentRow[],
  users: UserWithRoleRow[],
  field: 'triager_id' | 'cold_caller_id'
): RoleRankRow[] {
  const nameOf = new Map(users.map((u) => [u.id, u.full_name]))
  const map = new Map<string, RoleRankRow>()
  for (const a of appointments) {
    const ownerId = a[field]
    if (!ownerId) continue
    const row =
      map.get(ownerId) ??
      map
        .set(ownerId, {
          userId: ownerId,
          name: nameOf.get(ownerId) || 'Sin asignar',
          total: 0,
          qualified: 0,
          qualifiedRate: 0,
          noShows: 0,
          noShowRate: 0,
        })
        .get(ownerId)!
    row.total += 1
    if (a.offered === true || a.result === 'offer_made' || isAttended(a.status)) {
      row.qualified += 1
    }
    if (isNoShow(a.status)) row.noShows += 1
  }
  map.forEach((r) => {
    r.qualifiedRate = r.total ? (r.qualified / r.total) * 100 : 0
    r.noShowRate = r.total ? (r.noShows / r.total) * 100 : 0
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// Estados que cuentan como "ya contactado" — definidos junto al resto de estados del lead.
const CONTACTED_STATUSES: string[] = CONTACTED_LEAD_STATUSES

function num(x: number | string | null | undefined) {
  return Number(x ?? 0)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return '—'
  if (mins < 60) return `${Math.round(mins)} min`
  if (mins < 60 * 24) return `${(mins / 60).toFixed(1)} h`
  return `${(mins / (60 * 24)).toFixed(1)} d`
}

function formatDays(days: number | null): string {
  if (days === null) return '—'
  return `${days.toFixed(1)} días`
}

function FunnelStep({
  label,
  value,
  pct,
  icon: Icon,
}: {
  label: string
  value: number
  pct: number | null
  icon: React.ElementType
}) {
  return (
    <div className="flex-1 min-w-[140px] bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-brand-400" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {pct !== null && <div className="text-xs text-muted-foreground mt-1">{pct.toFixed(1)}% desde etapa anterior</div>}
    </div>
  )
}

function KPICardSimple({
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
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-brand-400" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
    </div>
  )
}

export default function PipelinePage() {
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [appointments, setAppointments] = useState<PipelineAppointmentRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [usersWithRoles, setUsersWithRoles] = useState<UserWithRoleRow[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [personId, setPersonId] = useState<string>('all')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const [contactsRes, apptRes, salesRes, collectionsRes, usersRes, usersRolesRes, targetsRes] = await Promise.all([
        supabase.from('contacts').select('id, created_at, first_contact_at, lead_status'),
        supabase
          .from('appointments')
          .select(
            'id, status, result, offered, setter_id, closer_id, triager_id, cold_caller_id, appointment_datetime, contact_id'
          ),
        supabase.from('sales').select('id, gross_amount, status, sale_date, closer_id, setter_id, contact_id'),
        supabase.from('collections').select('sale_id, gross_amount, collected_at, status'),
        supabase.from('users').select('id, full_name').eq('is_active', true),
        supabase.from('users').select('id, full_name, roles(key)').eq('is_active', true),
        supabase.from('targets').select('*').eq('is_active', true),
      ])
      if (!mounted) return
      setContacts(contactsRes.data || [])
      setAppointments(apptRes.data || [])
      setSales(salesRes.data || [])
      setCollections(collectionsRes.data || [])
      setUsers(usersRes.data || [])
      setUsersWithRoles((usersRolesRes.data as unknown as UserWithRoleRow[]) || [])
      setTargets((targetsRes.data as Target[]) || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])

  // Filtrado por persona + periodo. Cada entidad usa su propia fecha:
  // appointments → appointment_datetime, sales → sale_date, contacts → created_at, collections → collected_at
  const filteredAppointments = useMemo(() => {
    return appointments.filter(
      (a) =>
        (personId === 'all' || a.setter_id === personId || a.closer_id === personId) &&
        inPeriod(a.appointment_datetime, range)
    )
  }, [appointments, personId, range])

  const filteredSales = useMemo(() => {
    return sales.filter(
      (s) =>
        (personId === 'all' || s.closer_id === personId || s.setter_id === personId) && inPeriod(s.sale_date, range)
    )
  }, [sales, personId, range])

  const salesForPerson = useMemo(
    () => (personId === 'all' ? sales : sales.filter((s) => s.closer_id === personId || s.setter_id === personId)),
    [sales, personId]
  )

  const filteredCollections = useMemo(() => {
    const saleIds = new Set(salesForPerson.map((s) => s.id))
    return collections.filter((c) => (personId === 'all' || saleIds.has(c.sale_id)) && inPeriod(c.collected_at, range))
  }, [collections, salesForPerson, personId, range])

  const filteredContacts = useMemo(() => {
    const byPerson =
      personId === 'all'
        ? contacts
        : (() => {
            const contactIds = new Set<string>()
            for (const a of appointments) {
              if ((a.setter_id === personId || a.closer_id === personId) && a.contact_id) contactIds.add(a.contact_id)
            }
            for (const s of sales) {
              if ((s.closer_id === personId || s.setter_id === personId) && s.contact_id) contactIds.add(s.contact_id)
            }
            return contacts.filter((c) => contactIds.has(c.id))
          })()
    return byPerson.filter((c) => inPeriod(c.created_at, range))
  }, [contacts, appointments, sales, personId, range])

  // Embudo por COHORTE: todas las etapas se miden sobre el MISMO grupo de leads (los creados en
  // el periodo/persona elegidos), mirando lo que les pasó después sin importar cuándo. Antes cada
  // etapa se filtraba por SU PROPIA fecha (leads por created_at, citas por appointment_datetime...),
  // así que con el filtro de periodo activo "Citas" podía salir MAYOR que "Leads" (citas de leads
  // de otros meses cayendo dentro del periodo) y el % de conversión superaba el 100% — de ahí el
  // reporte de "los filtros no funcionan". Con cohorte, leads→citas→ofertas→cierres es siempre
  // monótono decreciente y el % de cada etapa es una conversión real.
  const funnel = useMemo(() => {
    const cohortIds = new Set(filteredContacts.map((c) => c.id))
    const matchesPerson = (setterId: string | null, closerId: string | null) =>
      personId === 'all' || setterId === personId || closerId === personId

    const leads = filteredContacts.length
    const contacted = filteredContacts.filter(
      (c) => !!c.first_contact_at || CONTACTED_STATUSES.includes(c.lead_status)
    ).length

    const cohortAppointments = appointments.filter(
      (a) => a.contact_id && cohortIds.has(a.contact_id) && matchesPerson(a.setter_id, a.closer_id)
    )
    const cohortSales = sales.filter(
      (s) => s.contact_id && cohortIds.has(s.contact_id) && matchesPerson(s.setter_id, s.closer_id)
    )

    const citas = new Set(cohortAppointments.map((a) => a.contact_id)).size
    const ofertas = new Set(
      cohortAppointments.filter((a) => a.offered === true || a.result === 'offer_made').map((a) => a.contact_id)
    ).size
    const cierres = new Set(
      cohortSales.filter((s) => s.status === 'active' || s.status === 'partial_refund').map((s) => s.contact_id)
    ).size

    return { leads, contacted, citas, ofertas, cierres }
  }, [filteredContacts, appointments, sales, personId])

  const pctOf = (curr: number, prev: number) => (prev ? (curr / prev) * 100 : null)

  const speedToLead = useMemo(() => {
    const diffs: number[] = []
    for (const c of filteredContacts) {
      if (!c.first_contact_at) continue
      const created = new Date(c.created_at).getTime()
      const contacted = new Date(c.first_contact_at).getTime()
      if (isNaN(created) || isNaN(contacted)) continue
      const diffMin = (contacted - created) / 1000 / 60
      if (diffMin >= 0) diffs.push(diffMin)
    }
    return median(diffs)
  }, [filteredContacts])

  // Primera cita por contacto (fecha más antigua de appointment_datetime), a partir de las citas filtradas
  const firstApptByContact = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of filteredAppointments) {
      if (!a.contact_id || !a.appointment_datetime) continue
      const t = new Date(a.appointment_datetime).getTime()
      if (isNaN(t)) continue
      const prev = map.get(a.contact_id)
      if (prev === undefined || t < prev) map.set(a.contact_id, t)
    }
    return map
  }, [filteredAppointments])

  // Media Lead -> Contacto (horas/min), consolidada aquí (misma base que speed-to-lead pero con avg)
  const leadToContact = useMemo(() => {
    const diffs: number[] = []
    for (const c of filteredContacts) {
      if (!c.first_contact_at) continue
      const created = new Date(c.created_at).getTime()
      const contacted = new Date(c.first_contact_at).getTime()
      if (isNaN(created) || isNaN(contacted)) continue
      const diffMin = (contacted - created) / 1000 / 60
      if (diffMin >= 0) diffs.push(diffMin)
    }
    return avg(diffs)
  }, [filteredContacts])

  // Media Lead -> Agenda (días): primera cita del contacto - contacts.created_at
  const leadToAgenda = useMemo(() => {
    const diffs: number[] = []
    for (const c of filteredContacts) {
      const firstAppt = firstApptByContact.get(c.id)
      if (firstAppt === undefined) continue
      const created = new Date(c.created_at).getTime()
      if (isNaN(created)) continue
      const diffDays = (firstAppt - created) / 1000 / 60 / 60 / 24
      if (diffDays >= 0) diffs.push(diffDays)
    }
    return avg(diffs)
  }, [filteredContacts, firstApptByContact])

  // Media Agenda -> Compra (días): sale.sale_date - primera cita del contacto (o created_at si no hay cita)
  const agendaToPurchase = useMemo(() => {
    const contactById = new Map(filteredContacts.map((c) => [c.id, c]))
    const diffs: number[] = []
    for (const s of filteredSales) {
      if (!s.contact_id || !s.sale_date) continue
      const contact = contactById.get(s.contact_id)
      if (!contact) continue
      const sold = new Date(s.sale_date).getTime()
      if (isNaN(sold)) continue
      const firstAppt = firstApptByContact.get(s.contact_id)
      const reference = firstAppt !== undefined ? firstAppt : new Date(contact.created_at).getTime()
      if (isNaN(reference)) continue
      const diffDays = (sold - reference) / 1000 / 60 / 60 / 24
      if (diffDays >= 0) diffs.push(diffDays)
    }
    return avg(diffs)
  }, [filteredContacts, filteredSales, firstApptByContact])

  const salesCycle = useMemo(() => {
    const contactById = new Map(filteredContacts.map((c) => [c.id, c]))
    const diffs: number[] = []
    for (const s of filteredSales) {
      if (!s.contact_id || !s.sale_date) continue
      const contact = contactById.get(s.contact_id)
      if (!contact) continue
      const created = new Date(contact.created_at).getTime()
      const sold = new Date(s.sale_date).getTime()
      if (isNaN(created) || isNaN(sold)) continue
      const diffDays = (sold - created) / 1000 / 60 / 60 / 24
      if (diffDays >= 0) diffs.push(diffDays)
    }
    return avg(diffs)
  }, [filteredContacts, filteredSales])

  const usersWithRole = useMemo(
    () => usersWithRoles.map((u) => ({ id: u.id, full_name: u.full_name, role: u.roles?.key ?? null })),
    [usersWithRoles]
  )
  const closers = useMemo(() => teamRanking(filteredSales, [], usersWithRole, 'closer'), [filteredSales, usersWithRole])
  const setters = useMemo(() => teamRanking(filteredSales, [], usersWithRole, 'setter'), [filteredSales, usersWithRole])
  const setterAgendas = useMemo(
    () => setterAgendaStats(filteredAppointments, usersWithRole),
    [filteredAppointments, usersWithRole]
  )
  const triagerRanking = useMemo(
    () => roleRanking(filteredAppointments, usersWithRoles, 'triager_id'),
    [filteredAppointments, usersWithRoles]
  )
  const coldCallerRanking = useMemo(
    () => roleRanking(filteredAppointments, usersWithRoles, 'cold_caller_id'),
    [filteredAppointments, usersWithRoles]
  )

  const targetProgress = useMemo(() => {
    // Ventana móvil vigente (hoy/semana/mes…) sobre datos completos, no acotados por la barra de periodo.
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return targets
      .map((t) => {
        const current = targetCurrentValue(t, { sales, collections, appointments }, todayStr)
        const pct = t.target_value ? (current / t.target_value) * 100 : 0
        return { target: t, current, pct }
      })
      .sort((a, b) => b.pct - a.pct)
  }, [targets, sales, collections, appointments])

  const hasData = contacts.length > 0 || appointments.length > 0 || sales.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Gauge className="w-6 h-6 text-brand-400" />
          <h1 className="text-2xl font-bold text-foreground">Ranking</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Ranking del equipo, objetivos y velocidad de conversión</p>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        members={usersWithRoles.map((u) => ({ id: u.id, full_name: u.full_name }))}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse bg-card rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse bg-card rounded-lg" />
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
          {/* Objetivos */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <TargetIcon className="w-3.5 h-3.5" /> Objetivos
            </h2>
            {targetProgress.length === 0 ? (
              <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
                No hay objetivos definidos (créalos en Objetivos)
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {targetProgress.map(({ target: t, current, pct }) => {
                  const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
                  const textColor = pct >= 100 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'
                  const isCurrency = ['revenue', 'cash_collected'].includes(t.metric_key)
                  const formatVal = (v: number) =>
                    isCurrency
                      ? formatCurrency(v)
                      : t.metric_key === 'conversion_rate'
                        ? `${v.toFixed(1)}%`
                        : v.toFixed(0)
                  return (
                    <div key={t.id} className="bg-card border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                        <span className={`text-xs font-semibold ${textColor}`}>{pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-2">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all`}
                          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatVal(current)} / {formatVal(t.target_value)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Funnel */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Embudo de conversión</h2>
            <div className="flex flex-wrap gap-3">
              <FunnelStep label="Leads" value={funnel.leads} pct={null} icon={Users} />
              <FunnelStep
                label="Contactado"
                value={funnel.contacted}
                pct={pctOf(funnel.contacted, funnel.leads)}
                icon={PhoneCall}
              />
              <FunnelStep
                label="Cita"
                value={funnel.citas}
                pct={pctOf(funnel.citas, funnel.contacted)}
                icon={CalendarCheck}
              />
              <FunnelStep
                label="Oferta"
                value={funnel.ofertas}
                pct={pctOf(funnel.ofertas, funnel.citas)}
                icon={HandCoins}
              />
              <FunnelStep
                label="Cierre"
                value={funnel.cierres}
                pct={pctOf(funnel.cierres, funnel.ofertas)}
                icon={Trophy}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Conversión global Lead → Cierre: {pctOf(funnel.cierres, funnel.leads)?.toFixed(1) ?? '—'}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Por cohorte: cada etapa cuenta a los mismos leads creados en el periodo elegido, mirando qué les pasó
              después (sin importar cuándo). Puede tardar en reflejar cierres de leads muy recientes.
            </p>
          </div>

          {/* Velocidad */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <KPICardSimple
              title="Speed-to-Lead"
              value={formatMinutes(speedToLead)}
              icon={Timer}
              description="tiempo mediano hasta el primer contacto"
            />
            <KPICardSimple
              title="Ciclo de venta medio"
              value={formatDays(salesCycle)}
              icon={Clock}
              description="del alta del lead al cierre"
            />
          </div>

          {/* Tiempos de conversión medios */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Tiempos de conversión medios
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KPICardSimple
                title="Lead → Contacto"
                value={formatMinutes(leadToContact)}
                icon={PhoneCall}
                description="media desde el alta del lead hasta el primer contacto"
              />
              <KPICardSimple
                title="Lead → Agenda"
                value={formatDays(leadToAgenda)}
                icon={CalendarCheck}
                description="media desde el alta del lead hasta la primera cita agendada"
              />
              <KPICardSimple
                title="Agenda → Compra"
                value={formatDays(agendaToPurchase)}
                icon={HandCoins}
                description="media desde la primera cita hasta la compra"
              />
            </div>
          </div>

          {/* Leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Ranking Closers</h3>
              {closers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Sin datos todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                        <th className="pb-2">Closer</th>
                        <th className="pb-2 text-right">Cierres</th>
                        <th className="pb-2 text-right">Ingresos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closers.map((c) => (
                        <tr key={c.userId} className="border-t border-border">
                          <td className="py-2 text-foreground">{c.name}</td>
                          <td className="py-2 text-right text-foreground">{c.sales}</td>
                          <td className="py-2 text-right text-foreground">{formatCurrency(c.gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Ranking Setters</h3>
              {setterAgendas.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Sin datos todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                        <th className="pb-2">Setter</th>
                        <th className="pb-2 text-right">Citas</th>
                        <th className="pb-2 text-right">Shows</th>
                        <th className="pb-2 text-right">% Show</th>
                      </tr>
                    </thead>
                    <tbody>
                      {setterAgendas.map((s) => (
                        <tr key={s.userId} className="border-t border-border">
                          <td className="py-2 text-foreground">{s.name}</td>
                          <td className="py-2 text-right text-foreground">{s.total}</td>
                          <td className="py-2 text-right text-foreground">{s.shows}</td>
                          <td className="py-2 text-right text-foreground">{s.showRate.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Ranking Triager y Cold Caller */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Ranking Triager</h3>
              {triagerRanking.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Sin datos todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                        <th className="pb-2">Triager</th>
                        <th className="pb-2 text-right">Citas</th>
                        <th className="pb-2 text-right">Cualificadas</th>
                        <th className="pb-2 text-right">% Cualif.</th>
                        <th className="pb-2 text-right">NR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {triagerRanking.map((r) => (
                        <tr key={r.userId} className="border-t border-border">
                          <td className="py-2 text-foreground">{r.name}</td>
                          <td className="py-2 text-right text-foreground">{r.total}</td>
                          <td className="py-2 text-right text-foreground">{r.qualified}</td>
                          <td className="py-2 text-right text-foreground">{r.qualifiedRate.toFixed(1)}%</td>
                          <td className="py-2 text-right text-foreground">{r.noShowRate.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Ranking Cold Caller</h3>
              {coldCallerRanking.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Sin datos todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                        <th className="pb-2">Cold Caller</th>
                        <th className="pb-2 text-right">Citas generadas</th>
                        <th className="pb-2 text-right">Cualificadas</th>
                        <th className="pb-2 text-right">% Cualif.</th>
                        <th className="pb-2 text-right">NR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coldCallerRanking.map((r) => (
                        <tr key={r.userId} className="border-t border-border">
                          <td className="py-2 text-foreground">{r.name}</td>
                          <td className="py-2 text-right text-foreground">{r.total}</td>
                          <td className="py-2 text-right text-foreground">{r.qualified}</td>
                          <td className="py-2 text-right text-foreground">{r.qualifiedRate.toFixed(1)}%</td>
                          <td className="py-2 text-right text-foreground">{r.noShowRate.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Setters ranking por ventas (referencia adicional) */}
          {setters.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Ventas atribuidas a Setters</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                      <th className="pb-2">Setter</th>
                      <th className="pb-2 text-right">Ventas</th>
                      <th className="pb-2 text-right">Ingresos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setters.map((s) => (
                      <tr key={s.userId} className="border-t border-border">
                        <td className="py-2 text-foreground">{s.name}</td>
                        <td className="py-2 text-right text-foreground">{s.sales}</td>
                        <td className="py-2 text-right text-foreground">{formatCurrency(s.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
