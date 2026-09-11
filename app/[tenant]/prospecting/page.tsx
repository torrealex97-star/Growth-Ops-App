'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KPICard } from '@/components/os/DashboardKPICard'
import {
  PhoneCall, Clock, Users, CheckCircle2, Target, MessageSquare,
  Handshake, CalendarCheck, Wallet, TrendingUp,
} from 'lucide-react'
import { lastNMonths, monthLabel, ACTIVE_SALE_STATUSES } from '@/lib/analytics'
import { formatCurrency } from '@/lib/utils'

// ==================== TYPES ====================

type KpiReportRow = {
  user_id: string
  role_key: string
  report_date: string
  data: Record<string, unknown>
}

type RoleUser = {
  id: string
  full_name: string
  is_active: boolean
  roles?: { key?: string } | null
}

type SaleRow = {
  setter_id: string | null
  closer_id: string | null
  gross_amount: number | string | null
  status: string
  sale_date: string | null
}

const PROSPECTING_ROLES = new Set(['setter', 'cold_caller', 'triager'])

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Suma segura de una clave numérica del JSONB `data`
const num = (data: Record<string, unknown>, key: string) => Number(data?.[key]) || 0

// Guard div/0 → null (se pinta como "—")
const safeDiv = (a: number, b: number): number | null => (b ? a / b : null)

function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(1)}%` : '—'
}

function fmtNum(v: number | null): string {
  return v !== null ? v.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—'
}

function ratioColor(ratio: number | null, good: number, warn: number): string {
  if (ratio === null) return 'text-muted-foreground'
  if (ratio >= good) return 'text-emerald-400'
  if (ratio >= warn) return 'text-amber-400'
  return 'text-red-400'
}

// ==================== AGREGACIÓN ====================

type Aggregates = {
  horas: number
  leadsAsignados: number
  leadsValidos: number
  intentos: number
  respuestas: number
  conversaciones: number
  ofertas: number
  citas: number
  depositos: number
}

function emptyAggregates(): Aggregates {
  return {
    horas: 0, leadsAsignados: 0, leadsValidos: 0, intentos: 0,
    respuestas: 0, conversaciones: 0, ofertas: 0, citas: 0, depositos: 0,
  }
}

function addReportToAggregates(agg: Aggregates, data: Record<string, unknown>) {
  agg.horas += num(data, 'horas')
  agg.leadsAsignados += num(data, 'leads_asignados')
  agg.leadsValidos += num(data, 'leads_validos')
  // intentos: sumamos también claves heredadas si `intentos` no está presente
  agg.intentos += num(data, 'intentos') || num(data, 'llamadas') || num(data, 'mensajes_enviados')
  agg.respuestas += num(data, 'respuestas')
  agg.conversaciones += num(data, 'conversaciones') || num(data, 'contactos_nuevos')
  agg.ofertas += num(data, 'ofertas')
  agg.citas += num(data, 'citas_agendadas')
  agg.depositos += num(data, 'depositos')
}

type MemberRow = {
  userId: string
  name: string
  roleKey: string
  horas: number
  intentos: number
  respuestas: number
  conversaciones: number
  citas: number
  depositos: number
  netRevenue: number
  pctResponse: number | null
  pctConvo: number | null
  pctBooked: number | null
  nrPerHr: number | null
}

// ==================== PAGE ====================

export default function ProspectingPage() {
  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState<KpiReportRow[]>([])
  const [roleUsers, setRoleUsers] = useState<RoleUser[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [ym, setYm] = useState(nowYm())
  const [personId, setPersonId] = useState<string>('all')

  const monthOptions = useMemo(() => lastNMonths(12, nowYm()).reverse(), [])

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()

      const [usersRes, salesRes] = await Promise.all([
        supabase.from('users').select('id, full_name, is_active, roles(key)').eq('is_active', true),
        supabase.from('sales').select('setter_id, closer_id, gross_amount, status, sale_date'),
      ])

      if (!mounted) return
      setRoleUsers((usersRes.data as RoleUser[] | null) || [])
      setSales(salesRes.data || [])
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [])

  // Reportes del mes seleccionado — cargados por rango de fechas
  useEffect(() => {
    let mounted = true
    async function loadReports() {
      const supabase = createClient()
      const [y, m] = ym.split('-').map(Number)
      const from = `${ym}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const to = `${ym}-${String(lastDay).padStart(2, '0')}`

      const { data } = await supabase
        .from('kpi_daily_reports')
        .select('user_id, role_key, report_date, data')
        .gte('report_date', from)
        .lte('report_date', to)

      if (!mounted) return
      setReports((data as KpiReportRow[] | null) || [])
    }
    loadReports()
    return () => { mounted = false }
  }, [ym])

  const prospectingUserIds = useMemo(
    () => new Set(roleUsers.filter((u) => PROSPECTING_ROLES.has(u.roles?.key || '')).map((u) => u.id)),
    [roleUsers]
  )

  // Ventas activas del periodo, atribuidas a un setter del equipo de prospección
  const attributedSales = useMemo(() => {
    const [y, m] = ym.split('-').map(Number)
    const from = `${ym}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${ym}-${String(lastDay).padStart(2, '0')}`
    return sales.filter((s) => {
      if (!ACTIVE_SALE_STATUSES.includes(s.status)) return false
      if (!s.sale_date || s.sale_date < from || s.sale_date > to) return false
      if (!s.setter_id || !prospectingUserIds.has(s.setter_id)) return false
      return true
    })
  }, [sales, ym, prospectingUserIds])

  const netRevenueBySetter = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of attributedSales) {
      if (!s.setter_id) continue
      map.set(s.setter_id, (map.get(s.setter_id) || 0) + (Number(s.gross_amount) || 0))
    }
    return map
  }, [attributedSales])

  // Reportes filtrados a roles de prospección
  const prospectingReports = useMemo(
    () => reports.filter((r) => PROSPECTING_ROLES.has(r.role_key) || prospectingUserIds.has(r.user_id)),
    [reports, prospectingUserIds]
  )

  // Reportes filtrados además por la persona seleccionada (KPIs agregados)
  const filteredReports = useMemo(
    () => personId === 'all'
      ? prospectingReports
      : prospectingReports.filter((r) => r.user_id === personId),
    [prospectingReports, personId]
  )

  const globalAgg = useMemo(() => {
    const agg = emptyAggregates()
    for (const r of filteredReports) addReportToAggregates(agg, r.data || {})
    return agg
  }, [filteredReports])

  // Ventas atribuidas, filtradas también por la persona seleccionada (como setter)
  const personAttributedSales = useMemo(
    () => personId === 'all'
      ? attributedSales
      : attributedSales.filter((s) => s.setter_id === personId),
    [attributedSales, personId]
  )

  const totalNetRevenue = useMemo(
    () => personAttributedSales.reduce((a, s) => a + (Number(s.gross_amount) || 0), 0),
    [personAttributedSales]
  )

  const daysInMonth = useMemo(() => {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m, 0).getDate()
  }, [ym])

  const kpis = useMemo(() => {
    const a = globalAgg
    const pctValid = safeDiv(a.leadsValidos, a.leadsAsignados)
    const intentosPerDay = safeDiv(a.intentos, daysInMonth)
    const intentosPerHr = safeDiv(a.intentos, a.horas)
    const pctResponse = safeDiv(a.respuestas, a.intentos)
    const pctConvo = safeDiv(a.conversaciones, a.respuestas)
    const pctOffer = safeDiv(a.ofertas, a.conversaciones)
    const pctBooked = safeDiv(a.citas, a.ofertas)
    const pctClose = safeDiv(a.depositos, a.citas)
    const nrPerHr = safeDiv(totalNetRevenue, a.horas)
    return {
      horas: a.horas,
      leadsAsignados: a.leadsAsignados,
      leadsValidos: a.leadsValidos,
      pctValid,
      intentos: a.intentos,
      intentosPerDay,
      intentosPerHr,
      respuestas: a.respuestas,
      pctResponse,
      conversaciones: a.conversaciones,
      pctConvo,
      ofertas: a.ofertas,
      pctOffer,
      citas: a.citas,
      pctBooked,
      depositos: a.depositos,
      pctClose,
      netRevenue: totalNetRevenue,
      nrPerHr,
    }
  }, [globalAgg, daysInMonth, totalNetRevenue])

  // Leaderboard por miembro
  const memberRows = useMemo<MemberRow[]>(() => {
    const byUser = new Map<string, Aggregates>()
    for (const r of prospectingReports) {
      const agg = byUser.get(r.user_id) || emptyAggregates()
      addReportToAggregates(agg, r.data || {})
      byUser.set(r.user_id, agg)
    }

    const rows: MemberRow[] = []
    for (const [userId, agg] of Array.from(byUser.entries())) {
      const user = roleUsers.find((u) => u.id === userId)
      if (!user) continue
      const nr = netRevenueBySetter.get(userId) || 0
      rows.push({
        userId,
        name: user.full_name,
        roleKey: user.roles?.key || '—',
        horas: agg.horas,
        intentos: agg.intentos,
        respuestas: agg.respuestas,
        conversaciones: agg.conversaciones,
        citas: agg.citas,
        depositos: agg.depositos,
        netRevenue: nr,
        pctResponse: safeDiv(agg.respuestas, agg.intentos),
        pctConvo: safeDiv(agg.conversaciones, agg.respuestas),
        pctBooked: safeDiv(agg.citas, agg.ofertas || agg.conversaciones),
        nrPerHr: safeDiv(nr, agg.horas),
      })
    }

    return rows.sort((a, b) => b.intentos - a.intentos)
  }, [prospectingReports, roleUsers, netRevenueBySetter])

  const hasData = filteredReports.length > 0

  const selectablePeople = useMemo(
    () => roleUsers.filter((u) => prospectingUserIds.has(u.id)),
    [roleUsers, prospectingUserIds]
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PhoneCall className="w-6 h-6 text-brand-400" />
            <h1 className="text-2xl font-bold text-foreground">Prospección</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Outreach y actividad diaria de setters, cold callers y triagers</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Persona</span>
            <select
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-brand-500"
            >
              <option value="all">Toda la empresa</option>
              {selectablePeople.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Mes</span>
            <select
              value={ym}
              onChange={(e) => setYm(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-brand-500"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-32 bg-card border border-border rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-64 bg-card border border-border rounded-lg animate-pulse" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-card border border-border rounded-lg">
          <PhoneCall className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Aún no hay reportes de KPI diarios</h3>
          <p className="text-muted-foreground text-sm">El equipo los rellena en &quot;KPI Diario&quot;.</p>
        </div>
      ) : (
        <>
          {/* KPIs globales */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Actividad de {monthLabel(ym)}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard title="Horas" value={fmtNum(kpis.horas)} icon={Clock} />
              <KPICard
                title="Leads asignados"
                value={fmtNum(kpis.leadsAsignados)}
                icon={Users}
                description={`Válidos: ${fmtNum(kpis.leadsValidos)} (${fmtPct(kpis.pctValid)})`}
              />
              <KPICard
                title="Intentos"
                value={fmtNum(kpis.intentos)}
                icon={Target}
                description={`${fmtNum(kpis.intentosPerDay)}/día · ${fmtNum(kpis.intentosPerHr)}/h`}
              />
              <KPICard
                title="Respuestas"
                value={fmtNum(kpis.respuestas)}
                icon={MessageSquare}
                description={`% Response: ${fmtPct(kpis.pctResponse)}`}
              />
              <KPICard
                title="Conversaciones"
                value={fmtNum(kpis.conversaciones)}
                icon={CheckCircle2}
                description={`% Convo: ${fmtPct(kpis.pctConvo)}`}
              />
              <KPICard
                title="Ofertas"
                value={fmtNum(kpis.ofertas)}
                icon={Handshake}
                description={`% Offer: ${fmtPct(kpis.pctOffer)}`}
              />
              <KPICard
                title="Citas (Booked)"
                value={fmtNum(kpis.citas)}
                icon={CalendarCheck}
                description={`% Booked: ${fmtPct(kpis.pctBooked)}`}
              />
              <KPICard
                title="Depósitos"
                value={fmtNum(kpis.depositos)}
                icon={Wallet}
                description={`% Close: ${fmtPct(kpis.pctClose)}`}
              />
            </div>
          </div>

          {/* Net Revenue + NR/Hr */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <KPICard
              title="Net Revenue"
              value={formatCurrency(kpis.netRevenue)}
              icon={TrendingUp}
              description="Ventas activas atribuidas al equipo de prospección"
            />
            <KPICard
              title="NR / Hr"
              value={kpis.nrPerHr !== null ? formatCurrency(kpis.nrPerHr) : '—'}
              icon={Wallet}
              description="Net revenue por hora invertida"
            />
          </div>

          {/* Leaderboard */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Leaderboard de prospección</h3>
            {memberRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Sin datos por miembro este mes.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
                      <th className="py-2 pr-4">Miembro</th>
                      <th className="py-2 pr-4">Rol</th>
                      <th className="py-2 pr-4">Horas</th>
                      <th className="py-2 pr-4">Intentos</th>
                      <th className="py-2 pr-4">Respuestas</th>
                      <th className="py-2 pr-4">% Response</th>
                      <th className="py-2 pr-4">Convos</th>
                      <th className="py-2 pr-4">% Convo</th>
                      <th className="py-2 pr-4">Citas</th>
                      <th className="py-2 pr-4">% Booked</th>
                      <th className="py-2 pr-4">NR/Hr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberRows.map((row) => (
                      <tr
                        key={row.userId}
                        className={`border-b border-border/50 text-foreground ${
                          personId !== 'all' && row.userId === personId ? 'bg-brand-500/10' : ''
                        }`}
                      >
                        <td className="py-2.5 pr-4 font-medium text-foreground">{row.name}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground capitalize">{row.roleKey.replace('_', ' ')}</td>
                        <td className="py-2.5 pr-4">{fmtNum(row.horas)}</td>
                        <td className="py-2.5 pr-4">{fmtNum(row.intentos)}</td>
                        <td className="py-2.5 pr-4">{fmtNum(row.respuestas)}</td>
                        <td className={`py-2.5 pr-4 font-medium ${ratioColor(row.pctResponse, 0.4, 0.2)}`}>
                          {fmtPct(row.pctResponse)}
                        </td>
                        <td className="py-2.5 pr-4">{fmtNum(row.conversaciones)}</td>
                        <td className={`py-2.5 pr-4 font-medium ${ratioColor(row.pctConvo, 0.5, 0.25)}`}>
                          {fmtPct(row.pctConvo)}
                        </td>
                        <td className="py-2.5 pr-4">{fmtNum(row.citas)}</td>
                        <td className={`py-2.5 pr-4 font-medium ${ratioColor(row.pctBooked, 0.3, 0.15)}`}>
                          {fmtPct(row.pctBooked)}
                        </td>
                        <td className="py-2.5 pr-4">
                          {row.nrPerHr !== null ? formatCurrency(row.nrPerHr) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
