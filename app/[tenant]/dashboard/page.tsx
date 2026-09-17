'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { KPICard } from '@/components/os/DashboardKPICard'
import { TeamRanking } from '@/components/os/TeamRanking'
import { AttributionTable } from '@/components/os/AttributionTable'
import { SetterAgendas } from '@/components/os/SetterAgendas'
import { QualificationInsights } from '@/components/os/QualificationInsights'
import { KaizenWidget } from '@/components/os/KaizenWidget'
import { DailyQuoteWidget } from '@/components/os/DailyQuoteWidget'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { FunnelStrip } from '@/components/os/FunnelStrip'
import { MarketingEfficiencyCard } from '@/components/os/MarketingEfficiencyCard'
import { DEFAULT_PERIOD,  getPeriodRange, inPeriod, toDateInputValue, type PeriodPreset } from '@/lib/filters/period'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import {
  TrendingUp,
  ShoppingCart,
  Wallet,
  Receipt,
  Target as TargetIcon,
  Coins,
  Percent,
  Bookmark,
  Save,
  Trash2,
} from 'lucide-react'
import {
  lastNMonths,
  prevMonth,
  monthLabel,
  monthlyKpis,
  pctDelta,
  revenueByMonth,
  teamRanking,
  attributionBySource,
  targetCurrentValue,
  setterAgendaStats,
  isActiveSale,
  funnelBySource,
  aggregateFunnel,
  type SaleRow,
  type CollectionRow,
  type AttributionRow,
  type UserRow,
  type AppointmentRow,
} from '@/lib/analytics'
import { formatCurrency } from '@/lib/utils'
import { FINANCE_QUERY_ROW_CAP } from '@/lib/finance/pnl'
import type { SavedDashboardView } from '@/lib/types/database'
import { useSesion, useTenant } from '@/lib/tenant-context'

const SalesChart = dynamic(() => import('@/components/os/SalesChart').then((m) => ({ default: m.SalesChart })), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-card rounded-lg" />,
})

type TargetRow = {
  id: string
  name: string
  metric_key: string
  scope_type: string
  scope_user_id: string | null
  period_type: string | null
  period_start: string
  period_end: string
  target_value: number | string
}

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type RoleUser = UserRow & { roles?: { key?: string } | null }

type DashboardFilters = {
  periodPreset: PeriodPreset
  customFrom: string
  customTo: string
  role: string
  member: string
}

const DEFAULT_FILTERS: DashboardFilters = {
  periodPreset: DEFAULT_PERIOD,
  customFrom: '',
  customTo: '',
  role: 'all',
  member: 'all',
}

// Roles por los que se puede filtrar en el dashboard (dimensiones de ventas/agendas).
const FILTER_ROLES = [
  { key: 'closer', label: 'Closer' },
  { key: 'setter', label: 'Setter' },
  { key: 'cold_caller', label: 'Cold caller' },
  { key: 'affiliate', label: 'Afiliado' },
]

export default function DashboardPage() {
  const tenant = useTenant()
  // La sesión que el layout ya resolvió: evita repetir auth.getUser() + from('users') en esta pantalla.
  const sesion = useSesion()
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [myRoleKey, setMyRoleKey] = useState<AppRole | ''>('')
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [commissions, setCommissions] = useState<
    { user_id: string; sale_id: string | null; commission_amount: number | string; direction: string; status: string }[]
  >([])
  const [futureCommissions, setFutureCommissions] = useState<{ userId: string; saleId: string; amount: number }[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [roleUsers, setRoleUsers] = useState<RoleUser[]>([])
  const [contactIds, setContactIds] = useState<string[]>([])
  const [contacts, setContacts] = useState<{ id: string; created_at: string | null }[]>([])
  const [attributions, setAttributions] = useState<AttributionRow[]>([])
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [targets, setTargets] = useState<TargetRow[]>([])
  const [ym, setYm] = useState(nowYm())

  // --- Eficiencia de marketing (gasto real de Meta Ads del periodo, vía campaign_daily) ---
  // null = todavía sin sincronizar/gasto en el periodo; false en adSpendAllowed = el rol de este
  // usuario no tiene acceso a esos datos (el bloque simplemente no se muestra, no tiene sentido
  // mostrarle a un closer un CTA para conectar Meta Ads).
  const [adSpend, setAdSpend] = useState<number | null>(null)
  const [adSpendAllowed, setAdSpendAllowed] = useState(true)
  const [adSpendLoading, setAdSpendLoading] = useState(true)

  // --- Filtros ---
  const [role, setRole] = useState('all')

  // --- Filtro unificado de periodo + persona (barra superior) ---
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_FILTERS.periodPreset)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [member, setMember] = useState('all')
  // Si el usuario tiene visibilidad "solo sus datos" (data_scope='own' y no es liderazgo), se fija
  // el filtro a sí mismo y no puede cambiarlo: el dashboard muestra únicamente lo suyo.
  const [selfScoped, setSelfScoped] = useState(false)
  // Fijo del usuario logueado + regla de desbloqueo (ventas mínimas del mes).
  const [myBaseSalary, setMyBaseSalary] = useState(0)
  const [myFijoUnlockType, setMyFijoUnlockType] = useState<'sales' | 'revenue'>('sales')
  const [myFijoMinSales, setMyFijoMinSales] = useState(0)
  const [myFijoMinRevenue, setMyFijoMinRevenue] = useState(0)

  // --- Vistas guardadas ---
  const [savedViews, setSavedViews] = useState<SavedDashboardView[]>([])
  const [selectedViewId, setSelectedViewId] = useState('')
  const [savingView, setSavingView] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()

      // LA CASCADA QUE SE ELIMINA. Aquí había tres viajes de red EN SERIE antes de pedir un solo dato
      // del dashboard: `auth.getUser()`, luego `users` para el scoping, y luego `users` OTRA VEZ para las
      // columnas del fijo. Los tres releían algo que app/[tenant]/layout.tsx acababa de traer con
      // `select('*, roles(key, name)')` para decidir si dejar entrar a esta pantalla.
      //
      // Las dos consultas a `users` estaban separadas porque las columnas del fijo podían no existir si
      // su migración no había corrido. Con `select('*')` del layout eso deja de ser un problema: si la
      // columna no existe, simplemente no viene en el objeto, y los `?? 0` de abajo ya lo cubren.
      if (!sesion || !mounted) return
      setUserId(sesion.userId)

      const userData = sesion.user as {
        full_name?: string
        data_scope?: string
        base_salary?: number | null
        fijo_unlock_type?: string | null
        fijo_min_sales?: number | null
        fijo_min_revenue?: number | null
        roles?: { key?: string } | null
      }
      setUserName(userData.full_name ?? '')
      setMyBaseSalary(Number(userData.base_salary ?? 0))
      const rk = (userData.roles?.key ?? '') as AppRole
      setMyRoleKey(rk)
      if (!isLeadership(rk) && userData.data_scope === 'own') {
        setSelfScoped(true)
        setMember(sesion.userId)
      }
      setMyFijoUnlockType((userData.fijo_unlock_type as 'sales' | 'revenue') ?? 'sales')
      setMyFijoMinSales(Number(userData.fijo_min_sales ?? 0))
      setMyFijoMinRevenue(Number(userData.fijo_min_revenue ?? 0))

      const [salesRes, collRes, usersRes, roleUsersRes, contactsRes, attrRes, apptRes, targetsRes, viewsRes, commRes] =
        await Promise.all([
          supabase
            .from('sales')
            .select('id, gross_amount, status, sale_date, closer_id, setter_id, affiliate_id, contact_id')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('collections')
            .select('sale_id, gross_amount, collected_at, status')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase.from('users').select('id, full_name'),
          supabase.from('users').select('id, full_name, roles(key)').eq('is_active', true),
          supabase.from('contacts').select('id, created_at').range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('contact_attributions')
            .select('contact_id, source, utm_source, utm_campaign, utm_content, is_primary')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('appointments')
            .select('appointment_datetime, status, setter_id, closer_id, cold_caller_id, affiliate_id')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('targets')
            .select(
              'id, name, metric_key, scope_type, scope_user_id, period_type, period_start, period_end, target_value'
            )
            .eq('is_active', true)
            .eq('scope_type', 'company'),
          supabase.from('saved_dashboard_views').select('*').or(`user_id.eq.${sesion.userId},scope.eq.shared`),
          supabase
            .from('commissions')
            .select('user_id, sale_id, commission_amount, direction, status')
            .range(0, FINANCE_QUERY_ROW_CAP),
        ])

      if (!mounted) return
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setUsers(usersRes.data || [])
      setRoleUsers((roleUsersRes.data as RoleUser[] | null) || [])
      setContactIds((contactsRes.data || []).map((c: { id: string }) => c.id))
      setContacts((contactsRes.data as { id: string; created_at: string | null }[]) || [])
      setAttributions(attrRes.data || [])
      setAppointments(apptRes.data || [])
      setTargets(targetsRes.data || [])
      setSavedViews((viewsRes.data as SavedDashboardView[] | null) || [])
      setCommissions(commRes.data || [])
      setLoading(false)

      // Comisiones futuras (esperadas, por cobrar) — endpoint server-side (respeta visibilidad por rol)
      fetch(`/api/${tenant}/evergreen/commissions/future`)
        .then((r) => r.json())
        .then((d) => {
          if (mounted && d?.rows) setFutureCommissions(d.rows)
        })
        .catch(() => {})
    }
    load()
    return () => {
      mounted = false
    }
  }, [tenant, sesion])

  // Meses para el selector: últimos 12 (más reciente primero)
  // Personas del rol elegido (para el selector de usuario del filtro de arriba).
  const membersForRole = useMemo(() => {
    if (role === 'all') return users
    return roleUsers.filter((u) => u.roles?.key === role).map((u) => ({ id: u.id, full_name: u.full_name }))
  }, [role, roleUsers, users])

  // --- Rango del filtro unificado de periodo ---
  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])

  // El mes de las tarjetas KPI (este mes vs anterior) sigue al periodo elegido.
  useEffect(() => {
    if (range.from) {
      const d = range.from
      setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
  }, [range])

  // Gasto real de Meta Ads del periodo activo (campaign_daily, no el acumulado histórico de
  // Unit Economics) — mismo endpoint que ya usa Marketing › Adquisición › Campañas.
  useEffect(() => {
    let active = true
    setAdSpendLoading(true)
    const query = new URLSearchParams()
    if (range.from) query.set('from', toDateInputValue(range.from))
    if (range.to) query.set('to', toDateInputValue(range.to))
    fetch(`/api/${tenant}/evergreen/meta/spend-range?${query}`)
      .then(async (r) => {
        if (!active) return
        if (r.status === 403) {
          setAdSpendAllowed(false)
          return
        }
        const j = await r.json().catch(() => ({}))
        const byCampaign = (j.byCampaign ?? {}) as Record<string, { spend: number }>
        const rows = Object.values(byCampaign)
        setAdSpend(rows.length > 0 ? rows.reduce((sum, c) => sum + Number(c.spend || 0), 0) : null)
      })
      .catch(() => {
        if (active) setAdSpend(null)
      })
      .finally(() => {
        if (active) setAdSpendLoading(false)
      })
    return () => {
      active = false
    }
  }, [tenant, range])

  // Coincidencia por rol+persona. Si no hay persona elegida (member='all') no filtra por equipo.
  const saleMatches = useCallback(
    (s: SaleRow) => {
      if (member === 'all') return true
      if (role === 'closer') return s.closer_id === member
      if (role === 'setter' || role === 'cold_caller') return s.setter_id === member // cold callers cobran como setter en ventas
      const affId = (s as { affiliate_id?: string | null }).affiliate_id
      if (role === 'affiliate') return affId === member
      return s.closer_id === member || s.setter_id === member || affId === member
    },
    [member, role]
  )

  const apptMatches = useCallback(
    (a: AppointmentRow) => {
      if (member === 'all') return true
      if (role === 'closer') return a.closer_id === member
      if (role === 'setter') return a.setter_id === member
      if (role === 'cold_caller') return (a as { cold_caller_id?: string | null }).cold_caller_id === member
      if (role === 'affiliate') return (a as { affiliate_id?: string | null }).affiliate_id === member
      return a.setter_id === member || a.closer_id === member
    },
    [member, role]
  )

  // --- Datos filtrados en cliente (periodo + rol/persona unificados en el filtro de arriba) ---
  const filteredSales = useMemo(() => {
    return sales.filter((s) => saleMatches(s) && inPeriod(s.sale_date, range))
  }, [sales, saleMatches, range])

  const filteredSaleIds = useMemo(() => new Set(filteredSales.map((s) => s.id)), [filteredSales])

  const filteredCollections = useMemo(() => {
    // Sin atajo para 'all': inPeriod ya trata el rango abierto (from/to null) como "todo", y así
    // TODA métrica pasa por el mismo camino — una colección huérfana (venta borrada) no se cuela.
    return collections.filter((c) => filteredSaleIds.has(c.sale_id) && inPeriod(c.collected_at, range))
  }, [collections, filteredSaleIds, range])

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => apptMatches(a) && inPeriod(a.appointment_datetime, range))
  }, [appointments, apptMatches, range])

  const cur = useMemo(
    () => monthlyKpis(filteredSales, filteredCollections, ym),
    [filteredSales, filteredCollections, ym]
  )
  const prev = useMemo(
    () => monthlyKpis(filteredSales, filteredCollections, prevMonth(ym)),
    [filteredSales, filteredCollections, ym]
  )
  const series = useMemo(() => revenueByMonth(filteredSales, lastNMonths(6, ym)), [filteredSales, ym])
  // roleUsers trae el rol real (roles(key)); necesario para no mezclar puestos en el ranking.
  const usersWithRole = useMemo(
    () => roleUsers.map((u) => ({ id: u.id, full_name: u.full_name, role: u.roles?.key ?? null })),
    [roleUsers]
  )
  const closers = useMemo(
    () => teamRanking(filteredSales, filteredCollections, usersWithRole, 'closer'),
    [filteredSales, filteredCollections, usersWithRole]
  )
  const setters = useMemo(
    () => teamRanking(filteredSales, filteredCollections, usersWithRole, 'setter'),
    [filteredSales, filteredCollections, usersWithRole]
  )
  const attribution = useMemo(
    () => attributionBySource(contactIds, attributions, filteredSales),
    [contactIds, attributions, filteredSales]
  )
  // Leads del periodo = contactos CREADOS en el rango activo (a diferencia de la tabla de
  // Atribución de más abajo, que usa el histórico completo de contactos — son preguntas de
  // negocio distintas: "¿qué trajo cada fuente en este periodo?" vs "¿qué trajo cada fuente en
  // toda la vida de la cuenta?"). No se filtra por rol/persona: un lead no pertenece a un closer.
  const filteredContactIds = useMemo(() => {
    // Sin atajo para 'all' (inPeriod con rango abierto = todo): un solo camino de filtrado.
    return contacts.filter((c) => inPeriod(c.created_at, range)).map((c) => c.id)
  }, [contacts, range])

  const funnelTotals = useMemo(
    () => aggregateFunnel(funnelBySource(filteredContactIds, attributions, filteredSales, filteredAppointments)),
    [filteredContactIds, attributions, filteredSales, filteredAppointments]
  )

  // Ingresos y clientes del MISMO periodo que el gasto. Aún no se acotan por campaña porque el
  // histórico importado no tiene contacts.campaign_id; hacerlo fingiría 0 € de ingresos. El gasto
  // sí queda acotado a las cuentas seleccionadas en Integraciones desde el endpoint server-side.
  const periodRevenue = useMemo(
    () => filteredSales.filter(isActiveSale).reduce((total, sale) => total + Number(sale.gross_amount || 0), 0),
    [filteredSales]
  )
  const periodCustomers = useMemo(
    () =>
      new Set(
        filteredSales
          .filter(isActiveSale)
          .map((sale) => sale.contact_id)
          .filter(Boolean)
      ).size,
    [filteredSales]
  )

  const setterAgendas = useMemo(
    () => setterAgendaStats(filteredAppointments, usersWithRole),
    [filteredAppointments, usersWithRole]
  )

  // Comisiones del ámbito filtrado: ganada (cash collected, sin liquidar, neto de devoluciones) y
  // futura (esperada de las cuotas por cobrar). Da visibilidad "en su cuenta" a cada persona.
  const commissionKpis = useMemo(() => {
    let ganada = 0
    for (const c of commissions) {
      if (c.sale_id && !filteredSaleIds.has(c.sale_id)) continue
      if (member !== 'all' && c.user_id !== member) continue
      if (c.status === 'liquidated') continue
      const amt = Number(c.commission_amount)
      ganada += c.direction === 'negative' ? -amt : amt
    }
    const futura = futureCommissions
      .filter((f) => filteredSaleIds.has(f.saleId) && (member === 'all' || f.userId === member))
      .reduce((s, f) => s + Number(f.amount), 0)
    return { ganada, futura }
  }, [commissions, futureCommissions, filteredSaleIds, member])

  // Fijo del usuario logueado en el mes `ym`: cuenta sus ventas del mes, comprueba si desbloquea el
  // fijo (>= fijo_min_sales) y suma fijo + comisiones = total que cobra "on time" este mes.
  const myFijo = useMemo(() => {
    if (!userId || myBaseSalary <= 0) return null
    // Ventas del usuario en el mes. OJO: completar una reserva actualiza la MISMA fila de venta,
    // así que contar filas ya cuenta 1 (no se duplica reserva + pago completado). Igual la facturación.
    // Canónico (Fase 5): isActiveSale (excluye cancelled/refunded/chargeback) — el filtro ad-hoc
    // anterior solo excluía cancelled/refunded y dejaba pasar chargeback, contando dinero que
    // salió de vuelta como si desbloqueara el fijo o generase comisión real.
    const mySalesMonth = sales.filter(
      (s) =>
        (s.closer_id === userId || s.setter_id === userId) && (s.sale_date || '').slice(0, 7) === ym && isActiveSale(s)
    )
    const salesCount = mySalesMonth.length
    const revenue = mySalesMonth.reduce((acc, s) => acc + Number(s.gross_amount || 0), 0)
    const monthSaleIds = new Set(mySalesMonth.map((s) => s.id))
    let comisiones = 0
    for (const c of commissions) {
      if (c.user_id !== userId) continue
      if (c.sale_id && !monthSaleIds.has(c.sale_id)) continue
      if (c.status === 'liquidated') continue
      const amt = Number(c.commission_amount)
      comisiones += c.direction === 'negative' ? -amt : amt
    }
    // Métrica de desbloqueo: por nº de ventas o por facturación
    const byRevenue = myFijoUnlockType === 'revenue'
    const target = byRevenue ? myFijoMinRevenue : myFijoMinSales
    const current = byRevenue ? revenue : salesCount
    const unlocked = target <= 0 || current >= target
    const fijoEarned = unlocked ? myBaseSalary : 0
    const remaining = Math.max(target - current, 0)
    return {
      fijo: myBaseSalary,
      byRevenue,
      target,
      current,
      salesCount,
      revenue,
      unlocked,
      remaining,
      comisiones,
      total: fijoEarned + comisiones,
    }
  }, [userId, myBaseSalary, myFijoUnlockType, myFijoMinSales, myFijoMinRevenue, sales, commissions, ym])

  // --- Vistas guardadas: helpers ---
  const currentFilters: DashboardFilters = { periodPreset, customFrom, customTo, role, member }

  function applyFilters(f: Partial<DashboardFilters>) {
    setPeriodPreset(f.periodPreset ?? DEFAULT_FILTERS.periodPreset)
    setCustomFrom(f.customFrom ?? '')
    setCustomTo(f.customTo ?? '')
    setRole(f.role ?? 'all')
    setMember(f.member ?? 'all')
  }

  function handleSelectView(viewId: string) {
    setSelectedViewId(viewId)
    if (!viewId) {
      applyFilters(DEFAULT_FILTERS)
      return
    }
    const view = savedViews.find((v) => v.id === viewId)
    if (view) applyFilters(view.filters as Partial<DashboardFilters>)
  }

  async function handleSaveView() {
    if (!userId) return
    const name = window.prompt('Nombre de la vista:')
    if (!name || !name.trim()) return
    setSavingView(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('saved_dashboard_views')
        .insert({ user_id: userId, name: name.trim(), scope: 'private', filters: currentFilters, widgets: {} })
        .select()
        .single()
      if (!error && data) {
        setSavedViews((prev) => [...prev, data as SavedDashboardView])
        setSelectedViewId((data as SavedDashboardView).id)
      }
    } finally {
      setSavingView(false)
    }
  }

  async function handleDeleteView() {
    if (!selectedViewId || !userId) return
    const view = savedViews.find((v) => v.id === selectedViewId)
    if (!view || view.user_id !== userId) return
    if (!window.confirm(`¿Borrar la vista "${view.name}"?`)) return
    const supabase = createClient()
    const { error } = await supabase.from('saved_dashboard_views').delete().eq('id', selectedViewId)
    if (!error) {
      setSavedViews((prev) => prev.filter((v) => v.id !== selectedViewId))
      setSelectedViewId('')
    }
  }

  const canDeleteSelectedView = useMemo(() => {
    const view = savedViews.find((v) => v.id === selectedViewId)
    return !!view && view.user_id === userId
  }, [savedViews, selectedViewId, userId])

  const delta = (c: number, p: number) => {
    const d = pctDelta(c, p)
    if (d === null) return {}
    return {
      delta: Math.round(d),
      deltaType: d > 0 ? ('up' as const) : d < 0 ? ('down' as const) : ('neutral' as const),
    }
  }
  const fmt = (n: number) => formatCurrency(n)

  return (
    <div className="dashboard-surface p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Hola de nuevo{userName ? `, ${userName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Todo tu negocio, de un vistazo.</p>
        </div>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        roles={selfScoped ? undefined : FILTER_ROLES}
        role={role}
        onRoleChange={
          selfScoped
            ? undefined
            : (v) => {
                setRole(v)
                setMember('all')
              }
        }
        members={selfScoped ? [] : membersForRole}
        member={member}
        onMemberChange={selfScoped ? () => {} : setMember}
        memberLabel={role === 'all' ? 'Persona' : (FILTER_ROLES.find((r) => r.key === role)?.label ?? 'Persona')}
        hasActiveFilters={
          periodPreset !== DEFAULT_FILTERS.periodPreset || (!selfScoped && (member !== 'all' || role !== 'all'))
        }
        onClear={() => {
          setPeriodPreset(DEFAULT_FILTERS.periodPreset)
          if (!selfScoped) {
            setMember('all')
            setRole('all')
          }
          setCustomFrom('')
          setCustomTo('')
        }}
      />

      {/* Vistas guardadas (presets del filtro de arriba) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs flex items-center gap-1">
          <Bookmark className="w-3 h-3" /> Vista
        </span>
        <select
          value={selectedViewId}
          onChange={(e) => handleSelectView(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-brand-500 min-w-[160px]"
        >
          <option value="">Vista actual</option>
          {savedViews.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.scope === 'shared' ? ' (compartida)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSaveView}
          disabled={savingView || !userId}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-foreground text-sm px-3 py-1.5 rounded-lg transition-colors"
        >
          <Save className="w-3.5 h-3.5" /> Guardar vista
        </button>
        {selectedViewId && canDeleteSelectedView && (
          <button
            type="button"
            onClick={handleDeleteView}
            className="flex items-center gap-1.5 bg-muted hover:bg-red-900/50 text-foreground hover:text-red-300 text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Borrar vista
          </button>
        )}
      </div>

      <div className={`grid grid-cols-1 ${adSpendAllowed ? 'xl:grid-cols-[2fr_1fr]' : ''} gap-4 items-start`}>
        {adSpendAllowed && <FunnelStrip totals={funnelTotals} loading={loading} />}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${adSpendAllowed ? 'xl:grid-cols-1' : ''} gap-4`}>
          <KPICard
            title="Comisión ganada"
            value={loading ? '—' : fmt(commissionKpis.ganada)}
            icon={Coins}
            loading={loading}
            description="cash collected · sin liquidar"
          />
          <KPICard
            title="Comisión futura"
            value={loading ? '—' : fmt(commissionKpis.futura)}
            icon={Percent}
            loading={loading}
            description="esperada · cuotas por cobrar"
          />
        </div>
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Facturación de {monthLabel(ym)}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Facturación bruta"
            value={loading ? '—' : fmt(cur.gross)}
            icon={TrendingUp}
            loading={loading}
            compareLabel="vs mes anterior"
            spark={
              series.length > 1 && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="kpiSparkFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--brand-500))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--brand-500))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke="hsl(var(--brand-500))"
                      strokeWidth={1.5}
                      fill="url(#kpiSparkFill)"
                      isAnimationActive
                      animationDuration={300}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )
            }
            {...delta(cur.gross, prev.gross)}
          />
          <KPICard
            title="Cash Collected"
            value={loading ? '—' : fmt(cur.cash)}
            icon={Wallet}
            loading={loading}
            compareLabel="vs mes anterior · cobrado real"
            {...delta(cur.cash, prev.cash)}
          />
          <KPICard
            title="Nº Ventas"
            value={loading ? '—' : cur.count}
            icon={ShoppingCart}
            loading={loading}
            compareLabel="vs mes anterior"
            {...delta(cur.count, prev.count)}
          />
          <KPICard
            title="Ticket medio"
            value={loading ? '—' : fmt(cur.avgTicket)}
            icon={Receipt}
            loading={loading}
            compareLabel="vs mes anterior · por venta"
            {...delta(cur.avgTicket, prev.avgTicket)}
          />
        </div>
      </div>

      {/* Evolución + Objetivos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <SalesChart data={series} title="Facturación últimos 6 meses" />
        </div>
        <div className="dashboard-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TargetIcon className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-foreground">Objetivos de empresa</h3>
          </div>
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No hay objetivos de empresa activos.</p>
          ) : (
            <div className="space-y-4">
              {targets.slice(0, 4).map((t) => {
                // Ventana móvil vigente (hoy/semana/mes…) sobre datos completos; ignora el filtro de periodo superior.
                const now = new Date()
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                const current = targetCurrentValue(t, { sales, collections, appointments }, todayStr)
                const goal = Number(t.target_value)
                const pct = goal ? Math.min((current / goal) * 100, 100) : 0
                const isMoney = ['revenue', 'cash_collected'].includes(t.metric_key)
                const show = (n: number) => (isMoney ? fmt(n) : Math.round(n).toString())
                return (
                  <div key={t.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-foreground truncate">{t.name}</span>
                      <span className="text-muted-foreground">
                        {show(current)} / {show(goal)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Facturación del mes seleccionado (live) */}
      {myFijo && (
        <div className="rounded-lg border border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-zinc-900 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-300/80">Tu retribución de {monthLabel(ym)}</p>
              <p className="text-3xl font-bold text-foreground mt-1">{loading ? '—' : fmt(myFijo.total)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fijo {myFijo.unlocked ? fmt(myFijo.fijo) : `${fmt(0)} (bloqueado)`} · Comisiones{' '}
                {fmt(myFijo.comisiones)}
              </p>
            </div>
            {myFijo.target > 0 && (
              <div className="min-w-[220px] flex-1 max-w-sm">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Desbloqueo del fijo</span>
                  <span className={myFijo.unlocked ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                    {myFijo.byRevenue
                      ? `${fmt(myFijo.revenue)} / ${fmt(myFijo.target)}`
                      : `${myFijo.salesCount}/${myFijo.target} ventas`}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${myFijo.unlocked ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(myFijo.current / myFijo.target, 1) * 100}%` }}
                  />
                </div>
                <p className="text-xs mt-1.5">
                  {myFijo.unlocked ? (
                    <span className="text-emerald-400">🎉 ¡Fijo desbloqueado! Ya cuenta en tu total.</span>
                  ) : myFijo.byRevenue ? (
                    <span className="text-amber-400">
                      Te faltan {fmt(myFijo.remaining)} de facturación para desbloquear tu fijo de {fmt(myFijo.fijo)}.
                    </span>
                  ) : (
                    <span className="text-amber-400">
                      Te {myFijo.remaining === 1 ? 'falta' : 'faltan'} {myFijo.remaining} venta
                      {myFijo.remaining === 1 ? '' : 's'} para desbloquear tu fijo de {fmt(myFijo.fijo)}.
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {adSpendAllowed && (
        <MarketingEfficiencyCard
          loading={adSpendLoading}
          spend={adSpend}
          revenue={periodRevenue}
          customers={periodCustomers}
        />
      )}

      {/* Ranking + Agendas por setter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TeamRanking closers={closers} setters={setters} />
        <SetterAgendas rows={setterAgendas} />
      </div>

      {/* Atribución */}
      <AttributionTable rows={attribution} />

      {/* Qué responde la gente (respuestas del formulario) */}
      <QualificationInsights />
      <div className="grid gap-4 lg:grid-cols-2">
        <DailyQuoteWidget />
        {userId && <KaizenWidget userId={userId} />}
      </div>
    </div>
  )
}
