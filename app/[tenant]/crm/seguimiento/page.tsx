'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AppointmentDetail } from '@/components/appointments/AppointmentDetail'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ClipboardList, MessageSquare, Table2, LayoutGrid, User as UserIcon, Clock, X } from 'lucide-react'
import { toast } from 'sonner'
import { useSearchParams } from 'next/navigation'
import { readEnum } from '@/lib/filters/url-state'
import type { AppointmentWithRelations, AppointmentStatus } from '@/lib/types/database'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import { getQualificationEntries, type Qualification } from '@/lib/appointments/qualification'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import { DateRangeCalendarPopover } from '@/components/ui/calendar-popover'
import { getCustomDateRange, inPeriod } from '@/lib/filters/period'

// Etapas del pipeline interno de seguimiento (independiente de `status` y del `pipeline_stage`
// de las integraciones externas — ver migration-v58-followup-pipeline.sql).
const FOLLOWUP_STAGE_LABELS: Record<string, string> = {
  pendiente_recontacto: 'Pendiente de recontactar',
  en_seguimiento_pago: 'En seguimiento de pago',
  reagendado_pendiente: 'Reagendado pendiente',
  cerrado: 'Cerrado',
  descualificado: 'Descualificado',
}
const FOLLOWUP_STAGE_COLORS: Record<string, string> = {
  pendiente_recontacto: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  en_seguimiento_pago: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  reagendado_pendiente: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  cerrado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  descualificado: 'bg-red-500/20 text-red-400 border-red-500/30',
}
const FOLLOWUP_STAGE_DOT: Record<string, string> = {
  sin_clasificar: 'bg-muted-foreground',
  pendiente_recontacto: 'bg-amber-500',
  en_seguimiento_pago: 'bg-indigo-500',
  reagendado_pendiente: 'bg-sky-500',
  cerrado: 'bg-emerald-500',
  descualificado: 'bg-red-500',
}
// Orden de las columnas del kanban: sin clasificar primero (lo nuevo entra ahí), luego el flujo
// natural del pipeline, cerrado/descualificado al final.
const KANBAN_STAGES = [
  'sin_clasificar',
  'pendiente_recontacto',
  'en_seguimiento_pago',
  'reagendado_pendiente',
  'cerrado',
  'descualificado',
] as const
type KanbanStage = (typeof KANBAN_STAGES)[number]

// Estados que suelen requerir seguimiento manual del equipo de ventas (además de las agendas
// marcadas explícitamente con needs_followup).
const RELEVANT_STATUSES: AppointmentStatus[] = ['no_show', 'seguimiento', 'rescheduled']

const STATUS_LABELS_LOCAL: Record<string, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  show: 'Asistió',
  no_show: 'No asistió',
  cancelled: 'Cancelada',
  rescheduled: 'Reagendada',
  completed: 'Completada',
  cancelled_admin: 'Cancelada (admin)',
  cancelled_lead: 'Cancelada (lead)',
  seguimiento: 'En seguimiento',
  reserva: 'Reserva',
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'ahora mismo'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `hace ${diffHr} h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `hace ${diffDay} día${diffDay === 1 ? '' : 's'}`
  const diffMonth = Math.floor(diffDay / 30)
  if (diffMonth < 12) return `hace ${diffMonth} mes${diffMonth === 1 ? '' : 'es'}`
  const diffYear = Math.floor(diffMonth / 12)
  return `hace ${diffYear} año${diffYear === 1 ? '' : 's'}`
}

export default function SeguimientoPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  // Sesión ya resuelta por el layout: evita repetir auth.getUser() + from('users') aquí.
  const sesion = useSesion()
  // La vista se puede fijar desde la URL (?view=kanban). El menú del CRM entra directo al kanban,
  // que es el pipeline comercial, sin obligar a pulsar el toggle en cada visita. Se lee con el mismo
  // helper que el resto de filtros de la app en vez de parsear el parámetro a mano.
  const searchParams = useSearchParams()
  const [view, setView] = useState<'tabla' | 'kanban'>(() =>
    readEnum(searchParams.get('view'), ['tabla', 'kanban'] as const, 'tabla')
  )
  const [appointments, setAppointments] = useState<AppointmentWithRelations[]>([])
  const [users, setUsers] = useState<{ id: string; full_name: string; roles?: { key?: string } }[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithRelations | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<string>('')
  const [currentUserName, setCurrentUserName] = useState<string>('')
  const [savingStageId, setSavingStageId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [followupStageFilter, setFollowupStageFilter] = useState<string>('all')
  const [setterFilter, setSetterFilter] = useState<string>('all')
  const [closerFilter, setCloserFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  const fetchData = async () => {
    const supabase = createClient()
    // DOS VIAJES DE RED MENOS, en serie y antes de poder pedir los seguimientos: los hacía ya el layout.
    let role = ''
    let scope = 'own'
    let userId = ''
    if (sesion) {
      userId = sesion.userId
      const userData = sesion.user as { data_scope?: string; full_name?: string; roles?: { key?: string } | null }
      role = userData.roles?.key ?? ''
      scope = userData.data_scope ?? 'own'
      setCurrentUserRole(role)
      setCurrentUserName(userData.full_name ?? '')
    }

    let query = supabase
      .from('appointments')
      .select('*, contacts(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name)')
      .eq('tenant_id', tenantId)
      .or(`needs_followup.eq.true,status.in.(${RELEVANT_STATUSES.join(',')})`)
      .order('appointment_datetime', { ascending: false })

    // Mismo criterio de scoping que /${tenant}/crm/agendas: liderazgo y quien tiene visibilidad
    // de equipo (data_scope='team') ven todo; el resto solo lo suyo.
    if (userId && role && !isLeadership(role as AppRole) && scope !== 'team') {
      if (role === 'closer') query = query.eq('closer_id', userId)
      else if (role === 'setter') query = query.eq('setter_id', userId)
    }

    const [appRes, usersRes] = await Promise.all([
      query,
      supabase.from('users').select('id, full_name, roles(key)').eq('is_active', true),
    ])

    if (appRes.error) {
      toast.error('Error al cargar agendas de seguimiento', { description: appRes.error.message })
    } else {
      setAppointments((appRes.data ?? []) as AppointmentWithRelations[])
    }
    if (usersRes.error) toast.error('Error al cargar usuarios', { description: usersRes.error.message })
    setUsers((usersRes.data ?? []) as { id: string; full_name: string; roles?: { key?: string } }[])
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    // `sesion` está memorizada en el layout: esto no entra en bucle, solo recarga si cambia de verdad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  const setters = useMemo(() => users.filter((u) => u.roles?.key === 'setter'), [users])
  const closers = useMemo(() => users.filter((u) => u.roles?.key === 'closer' || u.roles?.key === 'admin'), [users])

  const canChangeStatus = ['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(currentUserRole)
  const isAdmin = currentUserRole === 'admin'
  const dateRange = useMemo(() => getCustomDateRange(dateFrom, dateTo), [dateFrom, dateTo])

  const filtered = useMemo(() => {
    return appointments.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (followupStageFilter !== 'all') {
        if (followupStageFilter === 'sin_clasificar') {
          if (a.followup_stage) return false
        } else if (a.followup_stage !== followupStageFilter) {
          return false
        }
      }
      if (setterFilter !== 'all' && a.setter_id !== setterFilter) return false
      if (closerFilter !== 'all' && a.closer_id !== closerFilter) return false
      if ((dateFrom || dateTo) && !inPeriod(a.appointment_datetime, dateRange)) return false
      if (search.trim()) {
        const q = normalizeText(search.trim())
        const name = normalizeText(a.contacts?.full_name ?? '')
        if (!name.includes(q) && !phoneMatches(a.contacts?.phone, search)) return false
      }
      return true
    })
  }, [appointments, statusFilter, followupStageFilter, setterFilter, closerFilter, dateFrom, dateTo, dateRange, search])

  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    followupStageFilter !== 'all' ||
    setterFilter !== 'all' ||
    closerFilter !== 'all' ||
    !!dateFrom ||
    !!dateTo

  const byStage = useMemo(() => {
    const map: Record<KanbanStage, AppointmentWithRelations[]> = {
      sin_clasificar: [],
      pendiente_recontacto: [],
      en_seguimiento_pago: [],
      reagendado_pendiente: [],
      cerrado: [],
      descualificado: [],
    }
    for (const a of filtered) {
      const stage = (a.followup_stage ?? 'sin_clasificar') as KanbanStage
      map[stage].push(a)
    }
    return map
  }, [filtered])

  const handleFollowupStageChange = async (
    appointmentId: string,
    followupStage: AppointmentWithRelations['followup_stage']
  ) => {
    // Al descualificar, pedimos el motivo (lead sin teléfono real, datos falsos, etc) — se guarda
    // en las notas de la agenda. Si cancela el prompt, no se aplica el cambio de etapa.
    let reason: string | undefined
    if (followupStage === 'descualificado') {
      const input = window.prompt('Motivo de la descualificación (ej. "Lead sin teléfono real", "Lead falso"):')
      if (input === null) return
      reason = input.trim()
    }

    setSavingStageId(appointmentId)
    // Optimista: refleja el cambio ya mismo y revierte si el servidor falla.
    const prev = appointments.find((a) => a.id === appointmentId)
    const prevStage = prev?.followup_stage ?? null
    const prevNotes = prev?.notes ?? null
    setAppointments((cur) =>
      cur.map((a) =>
        a.id === appointmentId
          ? {
              ...a,
              followup_stage: followupStage,
              last_contacted_at: new Date().toISOString(),
              ...(reason ? { notes: reason } : {}),
            }
          : a
      )
    )
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/followup-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, followupStage, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No se pudo actualizar la etapa')
      toast.success('Etapa de seguimiento actualizada')
    } catch (err) {
      setAppointments((cur) =>
        cur.map((a) => (a.id === appointmentId ? { ...a, followup_stage: prevStage, notes: prevNotes } : a))
      )
      toast.error('Error al actualizar la etapa', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSavingStageId(null)
    }
  }

  const handleSaveNotes = async (appointmentId: string) => {
    const draft = notesDraft[appointmentId]
    const current = appointments.find((a) => a.id === appointmentId)
    if (draft === undefined || draft === (current?.notes ?? '')) return
    setSavingNotesId(appointmentId)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, patch: { notes: draft.trim() } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) throw new Error(json?.error || 'No se pudo guardar la nota')
      setAppointments((cur) => cur.map((a) => (a.id === appointmentId ? { ...a, notes: draft.trim() } : a)))
      toast.success('Nota guardada')
    } catch (err) {
      toast.error('No se pudo guardar la nota', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSavingNotesId(null)
    }
  }

  const handleStatusChange = (id: string, status: AppointmentStatus) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
    if (selectedAppointment?.id === id) {
      setSelectedAppointment((prev) => (prev ? { ...prev, status } : prev))
    }
  }

  const handleRescheduled = (id: string, patch: { appointment_datetime: string; duration_minutes: number }) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch, status: 'scheduled' as AppointmentStatus } : a))
    )
    if (selectedAppointment?.id === id) {
      setSelectedAppointment((prev) => (prev ? { ...prev, ...patch, status: 'scheduled' as AppointmentStatus } : prev))
    }
  }

  const handleFollowUpChange = (id: string, needsFollowup: boolean) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, needs_followup: needsFollowup } : a)))
    if (selectedAppointment?.id === id) {
      setSelectedAppointment((prev) => (prev ? { ...prev, needs_followup: needsFollowup } : prev))
    }
  }

  const handleCloserChanged = (id: string, closer: { id: string; full_name: string } | null) => {
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, closer_id: closer?.id ?? null, closer: closer as unknown as AppointmentWithRelations['closer'] }
          : a
      )
    )
    if (selectedAppointment?.id === id) {
      setSelectedAppointment((prev) =>
        prev
          ? { ...prev, closer_id: closer?.id ?? null, closer: closer as unknown as AppointmentWithRelations['closer'] }
          : prev
      )
    }
  }

  const handleSetterChanged = (id: string, setter: { id: string; full_name: string } | null) => {
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, setter_id: setter?.id ?? null, setter: setter as unknown as AppointmentWithRelations['setter'] }
          : a
      )
    )
    if (selectedAppointment?.id === id) {
      setSelectedAppointment((prev) =>
        prev
          ? { ...prev, setter_id: setter?.id ?? null, setter: setter as unknown as AppointmentWithRelations['setter'] }
          : prev
      )
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-400" />
            Pipeline de seguimiento
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Leads a recontactar (no-show), en seguimiento de pago o pendientes de una nueva fecha reagendada.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shrink-0">
          <button
            type="button"
            onClick={() => setView('tabla')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === 'tabla' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Table2 className="w-3.5 h-3.5" /> Tabla
          </button>
          <button
            type="button"
            onClick={() => setView('kanban')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Kanban
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar contacto o teléfono..."
          className="flex-1 min-w-[200px]"
        />

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-card border-border">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS_LOCAL).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={followupStageFilter} onValueChange={setFollowupStageFilter}>
          <SelectTrigger className="w-52 bg-card border-border">
            <SelectValue placeholder="Etapa de seguimiento" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todas las etapas</SelectItem>
            <SelectItem value="sin_clasificar">Sin clasificar</SelectItem>
            {Object.entries(FOLLOWUP_STAGE_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={setterFilter} onValueChange={setSetterFilter}>
          <SelectTrigger className="w-40 bg-card border-border">
            <SelectValue placeholder="Setter" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los setters</SelectItem>
            {setters.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={closerFilter} onValueChange={setCloserFilter}>
          <SelectTrigger className="w-40 bg-card border-border">
            <SelectValue placeholder="Closer" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los closers</SelectItem>
            {closers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangeCalendarPopover
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          className="w-full sm:w-72"
        />
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('')
              setStatusFilter('all')
              setFollowupStageFilter('all')
              setSetterFilter('all')
              setCloserFilter('all')
              setDateFrom('')
              setDateTo('')
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" /> Limpiar filtros
          </Button>
        )}
      </div>

      {/* Table / Kanban */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : view === 'kanban' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {KANBAN_STAGES.map((stage) => {
            const stageAppts = byStage[stage]
            const label = stage === 'sin_clasificar' ? 'Sin clasificar' : FOLLOWUP_STAGE_LABELS[stage]
            return (
              <div key={stage} className="rounded-lg border border-border bg-card/40 flex flex-col">
                <div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${FOLLOWUP_STAGE_DOT[stage]}`} />
                    <h3 className="text-sm font-semibold text-foreground truncate">{label}</h3>
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                    {stageAppts.length}
                  </span>
                </div>
                <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[70vh]">
                  {stageAppts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">Sin agendas en esta etapa</p>
                  ) : (
                    stageAppts.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        onClick={() => {
                          setSelectedAppointment(a)
                          setSheetOpen(true)
                        }}
                        className="w-full text-left rounded-lg border border-border bg-card p-3 hover:border-brand-500/50 transition-colors"
                      >
                        <p className="text-sm font-medium text-foreground truncate">
                          {a.contacts?.full_name || 'Sin nombre'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{a.contacts?.phone || '—'}</p>
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {STATUS_LABELS_LOCAL[a.status] || a.status}
                        </p>
                        {(a.closer?.full_name || a.setter?.full_name) && (
                          <div className="flex items-center gap-1 mt-1">
                            <UserIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-[11px] text-muted-foreground truncate">
                              {a.closer?.full_name || a.setter?.full_name}
                            </span>
                          </div>
                        )}
                        {a.notes && <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{a.notes}</p>}
                        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {timeAgo(a.last_contacted_at)}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Contacto</TableHead>
                <TableHead className="text-muted-foreground">Setter / Closer</TableHead>
                <TableHead className="text-muted-foreground">Estado</TableHead>
                <TableHead className="text-muted-foreground">Etapa de seguimiento</TableHead>
                <TableHead className="text-muted-foreground">Respuestas</TableHead>
                <TableHead className="text-muted-foreground">Notas</TableHead>
                <TableHead className="text-muted-foreground">Último contacto</TableHead>
                <TableHead className="text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No hay agendas pendientes de seguimiento</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((a) => {
                  const qualificationEntries = getQualificationEntries(a.qualification as Qualification | null)
                  const notesValue = notesDraft[a.id] ?? a.notes ?? ''
                  return (
                    <TableRow key={a.id} className="border-border hover:bg-card/50">
                      <TableCell>
                        <p className="text-foreground font-medium">{a.contacts?.full_name || 'Sin nombre'}</p>
                        <p className="text-muted-foreground text-xs">{a.contacts?.phone || '—'}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <p>{a.setter?.full_name || '—'}</p>
                        <p>{a.closer?.full_name || '—'}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {STATUS_LABELS_LOCAL[a.status] || a.status}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={a.followup_stage ?? 'sin_clasificar'}
                          disabled={savingStageId === a.id}
                          onValueChange={(v) =>
                            handleFollowupStageChange(
                              a.id,
                              v === 'sin_clasificar' ? null : (v as AppointmentWithRelations['followup_stage'])
                            )
                          }
                        >
                          <SelectTrigger
                            className={`w-52 border text-xs ${a.followup_stage ? FOLLOWUP_STAGE_COLORS[a.followup_stage] : 'bg-card border-border text-muted-foreground'}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="sin_clasificar">Sin clasificar</SelectItem>
                            {Object.entries(FOLLOWUP_STAGE_LABELS).map(([v, l]) => (
                              <SelectItem key={v} value={v}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {qualificationEntries.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 max-w-[220px] text-left"
                              >
                                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{qualificationEntries.map((e) => e.value).join(' · ')}</span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 max-h-80 overflow-y-auto space-y-2">
                              {qualificationEntries.map((e, i) => (
                                <div key={i} className="space-y-0.5">
                                  <p className="text-xs text-muted-foreground">{e.label}</p>
                                  <p className="text-sm text-foreground">{e.value}</p>
                                </div>
                              ))}
                            </PopoverContent>
                          </Popover>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <textarea
                          value={notesValue}
                          onChange={(e) => setNotesDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                          onBlur={() => handleSaveNotes(a.id)}
                          disabled={savingNotesId === a.id}
                          rows={2}
                          placeholder="Añadir nota…"
                          className="w-full bg-muted border border-border rounded-lg p-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 resize-y"
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(a.last_contacted_at)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedAppointment(a)
                            setSheetOpen(true)
                          }}
                        >
                          Ver ficha
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="bg-card border-border text-foreground w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-foreground">Detalle de Agenda</SheetTitle>
            {selectedAppointment && (
              <p className="text-muted-foreground text-sm">{selectedAppointment.contacts?.full_name}</p>
            )}
          </SheetHeader>
          {selectedAppointment && (
            <div className="mt-6">
              <AppointmentDetail
                // Misma razón que en Agendas: el Sheet no se desmonta al cambiar de cita, así que sin
                // key el panel conserva el estado de la anterior y lo guarda en la que está abierta.
                key={selectedAppointment.id}
                appointment={selectedAppointment}
                canChangeStatus={canChangeStatus}
                currentUserName={currentUserName}
                canDelete={isAdmin}
                canSeeRawPayload={isAdmin}
                canReassignCloser={isLeadership(currentUserRole as AppRole)}
                canReassignSetter={isLeadership(currentUserRole as AppRole)}
                closers={closers}
                setters={setters}
                onStatusChange={handleStatusChange}
                onRescheduled={handleRescheduled}
                onFollowUpChange={handleFollowUpChange}
                onCloserChanged={handleCloserChanged}
                onSetterChanged={handleSetterChanged}
                onCancelled={() => {
                  setSheetOpen(false)
                  fetchData()
                }}
                onDeleted={(id) => {
                  setAppointments((prev) => prev.filter((a) => a.id !== id))
                  setSheetOpen(false)
                  setSelectedAppointment(null)
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
