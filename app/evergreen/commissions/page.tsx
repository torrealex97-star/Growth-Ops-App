"use client"

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CommissionsTable } from '@/components/commissions/CommissionsTable'
import { CommissionInvoicePanel } from '@/components/commissions/CommissionInvoicePanel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KPICard } from '@/components/os/DashboardKPICard'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { TrendingUp, Users, Percent, ExternalLink, X, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import type { CommissionWithRelations, ParticipantType } from '@/lib/types/database'

type SimpleMember = { id: string; full_name: string }

type FutureRow = {
  installmentId: string; saleId: string; contact: string; dueDate: string
  userId: string; userName: string; participantType: ParticipantType
  base: number; percent: number; amount: number
  source: 'installment' | 'review'; collectionId?: string
}

const PARTICIPANT_LABELS: Record<ParticipantType, string> = {
  setter: 'Setter',
  closer: 'Closer',
  affiliate: 'Afiliado',
}

type PeriodPreset = 'all' | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'Todo',
  today: 'Hoy',
  week: 'Esta semana',
  month: 'Este mes',
  quarter: 'Este trimestre',
  year: 'Este año',
  custom: 'Personalizado',
}

function getPeriodRange(preset: PeriodPreset, customFrom: string, customTo: string): { from: Date | null; to: Date | null } {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

  switch (preset) {
    case 'today': {
      return { from: startOfDay(now), to: endOfDay(now) }
    }
    case 'week': {
      const day = now.getDay() === 0 ? 7 : now.getDay() // lunes = inicio de semana
      const monday = new Date(now)
      monday.setDate(now.getDate() - day + 1)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: startOfDay(monday), to: endOfDay(sunday) }
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3)
      const from = new Date(now.getFullYear(), q * 3, 1)
      const to = new Date(now.getFullYear(), q * 3 + 3, 0)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1)
      const to = new Date(now.getFullYear(), 11, 31)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'custom': {
      const from = customFrom ? startOfDay(new Date(customFrom)) : null
      const to = customTo ? endOfDay(new Date(customTo)) : null
      return { from, to }
    }
    default:
      return { from: null, to: null }
  }
}

function csvEscape(value: string): string {
  if (value == null) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvEscape(String(c))).join(','))
  const csv = '﻿' + lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function CommissionsPage() {
  const [commissions, setCommissions] = useState<CommissionWithRelations[]>([])
  const [future, setFuture] = useState<FutureRow[]>([])
  const [members, setMembers] = useState<SimpleMember[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserRole, setCurrentUserRole] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')

  // Filtros
  const [q, setQ] = useState('')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')
  const [filterMember, setFilterMember] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')

  const fetchCommissions = async () => {
    const supabase = createClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return

    const { data: userData } = await supabase
      .from('users')
      .select('*, roles(key)')
      .eq('id', authUser.id)
      .single()

    const role = (userData as { roles?: { key?: string } })?.roles?.key ?? ''
    setCurrentUserRole(role)
    setCurrentUserId(authUser.id)

    const canSeeAll = ['admin', 'director'].includes(role)

    let query = supabase
      .from('commissions')
      // `commissions` tiene DOS FK a `users` (user_id y approved_by); hay que desambiguar el embed
      // con el nombre del FK, o PostgREST devuelve PGRST201 y la consulta entera falla (lista vacía).
      .select(`*, users!commissions_user_id_fkey(id, full_name), sales(id, contact_id, contacts(full_name))`)
      .order('created_at', { ascending: false })

    if (!canSeeAll) {
      query = query.eq('user_id', authUser.id)
    }

    const { data, error } = await query

    if (error) {
      toast.error('Error al cargar comisiones')
    } else {
      setCommissions(data as CommissionWithRelations[])
    }

    if (canSeeAll) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, full_name')
        .order('full_name')
      setMembers((usersData as SimpleMember[]) ?? [])
    }

    setLoading(false)
  }

  const fetchFuture = () => {
    fetch('/api/evergreen/commissions/future')
      .then((r) => r.json())
      .then((d) => { if (d?.rows) setFuture(d.rows as FutureRow[]) })
      .catch(() => {})
  }

  useEffect(() => {
    fetchCommissions()
    fetchFuture()
  }, [])

  const canApprove = ['admin', 'director'].includes(currentUserRole)
  // Aprobar cuotas en revisión (plan personalizado): mismo alcance que payments/mark (cobros incluido).
  const canReview = ['admin', 'director', 'cobros'].includes(currentUserRole)
  const [approvingReview, setApprovingReview] = useState<string | null>(null)

  const handleApproveReview = async (collectionId: string) => {
    setApprovingReview(collectionId)
    try {
      const res = await fetch('/api/evergreen/collections/approve-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Error al aprobar el cobro', { description: d?.error })
        return
      }
      toast.success('Cobro aprobado: comisión generada')
      fetchFuture()
      fetchCommissions()
    } finally {
      setApprovingReview(null)
    }
  }

  // Meses disponibles (a partir de liquidation_month) para el select de filtro
  const availableMonths = useMemo(() => {
    const set = new Set<string>()
    commissions.forEach((c) => {
      const src = c.liquidation_month || c.created_at
      if (!src) return
      const key = String(src).slice(0, 7) // YYYY-MM
      set.add(key)
    })
    return Array.from(set).sort().reverse()
  }, [commissions])

  const monthLabel = (key: string) => {
    const [y, m] = key.split('-')
    const d = new Date(Number(y), Number(m) - 1, 1)
    return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  }

  const periodRange = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])

  const filteredCommissions = useMemo(() => {
    const nq = normalizeText(q.trim())
    return commissions.filter((c) => {
      if (nq) {
        const member = normalizeText(c.users?.full_name || '')
        const sales = c.sales as { contacts?: { full_name?: string } | null } | null
        const contact = normalizeText(sales?.contacts?.full_name || '')
        if (!member.includes(nq) && !contact.includes(nq)) return false
      }

      const dateSrc = c.liquidation_month || c.created_at
      const monthKey = dateSrc ? String(dateSrc).slice(0, 7) : ''

      if (filterMonth !== 'all' && monthKey !== filterMonth) return false

      if (filterFrom) {
        const created = c.created_at ? new Date(c.created_at) : null
        const from = new Date(filterFrom)
        if (!created || created < from) return false
      }

      if (filterTo) {
        const created = c.created_at ? new Date(c.created_at) : null
        const to = new Date(filterTo)
        to.setHours(23, 59, 59, 999)
        if (!created || created > to) return false
      }

      if (filterMember !== 'all' && c.user_id !== filterMember) return false

      if (filterType !== 'all' && c.participant_type !== filterType) return false

      if (periodPreset !== 'all') {
        const relevant = c.created_at ? new Date(c.created_at) : null
        if (!relevant) return false
        if (periodRange.from && relevant < periodRange.from) return false
        if (periodRange.to && relevant > periodRange.to) return false
      }

      return true
    })
  }, [commissions, q, filterMonth, filterFrom, filterTo, filterMember, filterType, periodPreset, periodRange])

  const hasActiveFilters =
    !!q || filterMonth !== 'all' || filterFrom || filterTo || filterMember !== 'all' || filterType !== 'all' || periodPreset !== 'all'

  const clearFilters = () => {
    setQ('')
    setFilterMonth('all')
    setFilterFrom('')
    setFilterTo('')
    setFilterMember('all')
    setFilterType('all')
    setPeriodPreset('all')
    setCustomFrom('')
    setCustomTo('')
  }

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'all') return 'todas'
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, customFrom, customTo])

  const handleExportCSV = () => {
    const headers = ['Fecha', 'Miembro', 'Tipo', 'Estado', 'Direccion', 'Importe', 'Venta']
    const rows = filteredCommissions.map((c) => [
      c.created_at ? new Date(c.created_at).toLocaleDateString('es-ES') : '',
      c.users?.full_name ?? '',
      PARTICIPANT_LABELS[c.participant_type] ?? c.participant_type,
      c.status,
      c.direction,
      c.commission_amount,
      c.sale_id ?? '',
    ])
    downloadCSV(`comisiones_${periodFileTag}.csv`, headers, rows)
  }

  const pending = useMemo(
    () => filteredCommissions.filter(c => c.status === 'pending' && c.direction === 'positive'),
    [filteredCommissions]
  )
  const approved = useMemo(() => filteredCommissions.filter(c => c.status === 'approved'), [filteredCommissions])
  const liquidated = useMemo(() => filteredCommissions.filter(c => c.status === 'liquidated'), [filteredCommissions])
  const negative = useMemo(() => filteredCommissions.filter(c => c.direction === 'negative'), [filteredCommissions])

  const totalPending = pending.reduce((sum, c) => sum + c.commission_amount, 0)
  const totalApproved = approved.reduce((sum, c) => sum + c.commission_amount, 0)
  const totalLiquidated = liquidated.reduce((sum, c) => sum + c.commission_amount, 0)

  // Comisiones FUTURAS (por cobrar): proyección de las cuotas pendientes (autofinanciado/Sequra)
  const filteredFuture = useMemo(
    () =>
      future.filter((f) => {
        if (filterMember !== 'all' && f.userId !== filterMember) return false
        if (filterType !== 'all' && f.participantType !== filterType) return false
        return true
      }),
    [future, filterMember, filterType]
  )
  const totalFuture = filteredFuture.reduce((sum, f) => sum + f.amount, 0)

  // KPIs generales del filtro aplicado (todas las comisiones que cumplen el filtro, sin distinguir tab)
  const filteredTotal = filteredCommissions.reduce((sum, c) => sum + c.commission_amount, 0)
  const filteredCount = filteredCommissions.length
  const totalsByType = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {
      setter: { count: 0, total: 0 },
      closer: { count: 0, total: 0 },
      affiliate: { count: 0, total: 0 },
    }
    filteredCommissions.forEach((c) => {
      if (!map[c.participant_type]) map[c.participant_type] = { count: 0, total: 0 }
      map[c.participant_type].count += 1
      map[c.participant_type].total += c.commission_amount
    })
    return map
  }, [filteredCommissions])

  const handleApprove = async (ids: string[]) => {
    const supabase = createClient()
    const { data: authUser } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('commissions')
      .update({ status: 'approved', approved_by: authUser.user?.id })
      .in('id', ids)

    if (error) {
      toast.error('Error al aprobar comisiones')
      return
    }

    toast.success(`${ids.length} comision(es) aprobada(s)`)
    fetchCommissions()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Comisiones</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {canApprove ? 'Gestion de comisiones del equipo' : 'Tus comisiones'}
        </p>
      </div>

      {/* Facturas de comisiones: el comercial adjunta la suya; admin ve todas */}
      {currentUserId && (
        <CommissionInvoicePanel
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          members={members}
        />
      )}

      {/* Filtros */}
      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Filtros</span>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                <X className="w-3.5 h-3.5 mr-1" />
                Limpiar filtros
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportCSV}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Exportar CSV
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <SearchBox value={q} onChange={setQ} placeholder="Miembro o cliente..." className="w-full" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Periodo</Label>
            <Select value={periodPreset} onValueChange={(v) => setPeriodPreset(v as PeriodPreset)}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
                  <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {periodPreset === 'custom' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Periodo desde</Label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-muted border-border h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Periodo hasta</Label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-muted border-border h-9"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Mes de liquidacion</Label>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Todos los meses</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Desde</Label>
            <Input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="bg-muted border-border h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Hasta</Label>
            <Input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="bg-muted border-border h-9"
            />
          </div>

          {canApprove && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Miembro del equipo</Label>
              <Select value={filterMember} onValueChange={setFilterMember}>
                <SelectTrigger className="bg-muted border-border h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">Todos</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tipo / afiliado</Label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="setter">Setter</SelectItem>
                <SelectItem value="closer">Closer</SelectItem>
                <SelectItem value="affiliate">Afiliado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* KPIs del filtro aplicado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Filtrado"
          value={formatCurrency(filteredTotal)}
          icon={TrendingUp}
          loading={loading}
          description={`${filteredCount} comisiones`}
        />
        <KPICard
          title="Setters"
          value={formatCurrency(totalsByType.setter?.total ?? 0)}
          icon={Users}
          loading={loading}
          description={`${totalsByType.setter?.count ?? 0} comisiones`}
        />
        <KPICard
          title="Closers"
          value={formatCurrency(totalsByType.closer?.total ?? 0)}
          icon={Users}
          loading={loading}
          description={`${totalsByType.closer?.count ?? 0} comisiones`}
        />
        <KPICard
          title="Afiliados"
          value={formatCurrency(totalsByType.affiliate?.total ?? 0)}
          icon={Percent}
          loading={loading}
          description={`${totalsByType.affiliate?.count ?? 0} comisiones`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pendiente (ganada)"
          value={formatCurrency(totalPending)}
          icon={TrendingUp}
          loading={loading}
          description={`${pending.length} · cash collected, sin aprobar`}
        />
        <KPICard
          title="Aprobado"
          value={formatCurrency(totalApproved)}
          icon={TrendingUp}
          loading={loading}
          description={`${approved.length} · pasados 15 días`}
        />
        <KPICard
          title="Liquidado"
          value={formatCurrency(totalLiquidated)}
          icon={TrendingUp}
          loading={loading}
          description={`${liquidated.length} · pagadas`}
        />
        <KPICard
          title="Futuras (por cobrar)"
          value={formatCurrency(totalFuture)}
          icon={Percent}
          loading={loading}
          description={`${filteredFuture.length} cuotas · esperadas`}
        />
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="pending">
            Pendientes
            {pending.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="approved">
            Aprobadas
            {approved.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{approved.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="liquidated">
            Liquidadas
            {liquidated.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{liquidated.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="future">
            Futuras
            {filteredFuture.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{filteredFuture.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="negative">
            Negativas
            {negative.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{negative.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {loading ? <div className="h-48 bg-card rounded-lg animate-pulse" /> : (
            <CommissionsTable commissions={pending} canApprove={canApprove} onApprove={handleApprove} />
          )}
        </TabsContent>
        <TabsContent value="approved" className="mt-4">
          {loading ? <div className="h-48 bg-card rounded-lg animate-pulse" /> : (
            <CommissionsTable commissions={approved} canApprove={false} />
          )}
        </TabsContent>
        <TabsContent value="liquidated" className="mt-4">
          {loading ? <div className="h-48 bg-card rounded-lg animate-pulse" /> : (
            <CommissionsTable commissions={liquidated} canApprove={false} />
          )}
        </TabsContent>
        <TabsContent value="future" className="mt-4">
          <p className="text-xs text-muted-foreground mb-2">
            Comisión <span className="text-amber-400 font-medium">esperada</span> de las cuotas que el cliente aún tiene que pagar (autofinanciado / Sequra), más las cuotas de un plan <span className="text-blue-400 font-medium">personalizado</span> ya cobradas pero en revisión manual de cobros. Se convierte en comisión real cuando se cobra (o, en revisión, cuando el equipo la aprueba).
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
              {filteredFuture.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No hay comisiones futuras por cobrar</div>
              ) : (
                filteredFuture
                  .slice()
                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                  .map((f) => (
                    <div key={`${f.installmentId}-${f.userId}-${f.participantType}`} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-card/40">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-muted-foreground shrink-0 w-20">{new Date(f.dueDate).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                        <span className="text-sm text-foreground truncate">{f.userName}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize shrink-0">
                          {PARTICIPANT_LABELS[f.participantType] ?? f.participantType}
                        </span>
                        {f.source === 'review' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 shrink-0">
                            En revisión
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">{f.contact}</span>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-xs text-muted-foreground">{f.percent}%</span>
                        <span className="text-sm font-medium text-amber-400">{formatCurrency(f.amount)}</span>
                        {f.source === 'review' && canReview && f.collectionId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={approvingReview === f.collectionId}
                            onClick={() => handleApproveReview(f.collectionId!)}
                          >
                            {approvingReview === f.collectionId ? 'Aprobando...' : 'Aprobar'}
                          </Button>
                        )}
                        <Link href={`/evergreen/sales/${f.saleId}`} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                          Venta<ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="negative" className="mt-4">
          {loading ? <div className="h-48 bg-card rounded-lg animate-pulse" /> : (
            <CommissionsTable commissions={negative} canApprove={false} />
          )}
        </TabsContent>
      </Tabs>

      {/* Detalle plano con enlace directo a la venta, para dejar clara la trazabilidad comision -> venta */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card/50">
          <h2 className="text-sm font-medium text-foreground">Detalle: comision y venta asociada</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Cada comision proviene de una venta concreta. Haz clic para verla.</p>
        </div>
        <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Cargando...</div>
          ) : filteredCommissions.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No hay comisiones para los filtros seleccionados</div>
          ) : (
            filteredCommissions.map((c) => (
              <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-card/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm text-foreground truncate">{c.users?.full_name || '—'}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize shrink-0">
                    {PARTICIPANT_LABELS[c.participant_type] ?? c.participant_type}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{c.status}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className={`text-sm font-medium ${c.direction === 'negative' ? 'text-red-400' : 'text-emerald-400'}`}>
                    {c.direction === 'negative' ? '-' : ''}{formatCurrency(c.commission_amount)}
                  </span>
                  {c.sale_id ? (
                    <Link
                      href={`/evergreen/sales/${c.sale_id}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                    >
                      Venta
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin venta</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
