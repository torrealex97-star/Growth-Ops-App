'use client'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AppointmentDetail } from '@/components/appointments/AppointmentDetail'
import { AgendasAnalysisView } from '@/components/appointments/AgendasAnalysisView'
import { AgendasMetricsView } from '@/components/appointments/AgendasMetricsView'
import { CalendarPopover, DateRangeCalendarPopover } from '@/components/ui/calendar-popover'
import {
  Calendar,
  Search,
  Plus,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Table2,
  CalendarDays,
  Loader,
  Users as UsersIcon,
  Copy,
  Banknote,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import { formatDateTime, formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type { AppointmentWithRelations, AppointmentStatus, User, Contact, Sale } from '@/lib/types/database'
import { guessContactTimezone, DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from '@/lib/timezone'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import {
  DEFAULT_PERIOD,
  getPeriodRange,
  getPreviousPeriodRange,
  inPeriod,
  type PeriodPreset,
} from '@/lib/filters/period'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import {
  CATEGORY_BADGE_CLASSES,
  CATEGORY_BLOCK_CLASSES,
  CATEGORY_LABELS,
  STATUS_LABELS,
  getAppointmentCategory,
  isNoShow,
} from '@/lib/appointments/status'

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500'

const columnHelper = createColumnHelper<AppointmentWithRelations>()
const coreRowModel = getCoreRowModel()
const sortedRowModel = getSortedRowModel()
const filteredRowModel = getFilteredRowModel()

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const CALENDAR_HOURS = Array.from({ length: 14 }, (_, i) => 8 + i) // 8..21
const PX_PER_HOUR = 52 // debe coincidir con min-h de la celda de hora

// Paleta estable por closer: en vista semana con varios closers solapados, el color
// distingue a quién pertenece cada cita (antes todas usaban el mismo tono brand-300).
const CLOSER_DOT_COLORS = [
  'bg-sky-400',
  'bg-amber-400',
  'bg-violet-400',
  'bg-rose-400',
  'bg-lime-400',
  'bg-cyan-400',
  'bg-fuchsia-400',
  'bg-orange-400',
]
function closerColorClass(closerId: string | null | undefined): string {
  if (!closerId) return 'bg-muted-foreground'
  let hash = 0
  for (let i = 0; i < closerId.length; i++) hash = (hash * 31 + closerId.charCodeAt(i)) >>> 0
  return CLOSER_DOT_COLORS[hash % CLOSER_DOT_COLORS.length]
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function AppointmentsPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  // La sesión que el layout ya resolvió: dos consultas menos antes de poder pedir las agendas.
  const sesion = useSesion()
  const router = useRouter()
  const [appointments, setAppointments] = useState<AppointmentWithRelations[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithRelations | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<string>('')
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserScope, setCurrentUserScope] = useState<string>('own')
  const [currentUserName, setCurrentUserName] = useState<string>('')
  // Conflictos de closer: contacto ya atendido por un closer distinto al de su agenda más reciente.
  const [closerConflicts, setCloserConflicts] = useState<
    Record<string, { owning_closer_id: string; owning_closer_name: string; conflicting_appointment_id: string }>
  >({})
  const [reassigningConflictId, setReassigningConflictId] = useState<string | null>(null)

  // View switcher
  const [view, setView] = useState<'tabla' | 'calendario' | 'analisis' | 'metricas'>('calendario')
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()))
  const [calMode, setCalMode] = useState<'week' | 'day'>('week')
  // En modo día, closers a mostrar como columnas (lanes) estilo GHL. Vacío = todos.
  const [dayCloserIds, setDayCloserIds] = useState<string[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [calendarUserFilter, setCalendarUserFilter] = useState<string>('all')

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [setterFilter, setSetterFilter] = useState<string>('all')
  const [closerFilter, setCloserFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  // Aísla las agendas duplicadas (mismo contacto y misma hora) para poder limpiarlas.
  const [onlyDuplicates, setOnlyDuplicates] = useState(false)
  const [onlyFollowUp, setOnlyFollowUp] = useState(false)

  // New appointment modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [naContactSearch, setNaContactSearch] = useState('')
  const [naContactResults, setNaContactResults] = useState<Contact[]>([])
  const [naSelectedContact, setNaSelectedContact] = useState<Contact | null>(null)
  const [naSearchLoading, setNaSearchLoading] = useState(false)
  const [naShowNewContactForm, setNaShowNewContactForm] = useState(false)
  const [naNewContactName, setNaNewContactName] = useState('')
  const [naNewContactEmail, setNaNewContactEmail] = useState('')
  const [naNewContactPhone, setNaNewContactPhone] = useState('')
  const [naNewContactInstagram, setNaNewContactInstagram] = useState('')
  const [naDatetime, setNaDatetime] = useState('')
  const [naDurationMinutes, setNaDurationMinutes] = useState('30')
  const [naSetterId, setNaSetterId] = useState('')
  const [naCloserId, setNaCloserId] = useState('')
  const [naSaving, setNaSaving] = useState(false)
  // Calendly (bidireccional): huecos reales del closer
  const [naSlotDate, setNaSlotDate] = useState('') // YYYY-MM-DD
  const [naSlots, setNaSlots] = useState<{ start_time: string }[]>([])
  const [naSelectedSlot, setNaSelectedSlot] = useState('') // ISO UTC del hueco elegido
  const [naSlotsLoading, setNaSlotsLoading] = useState(false)
  const [naHasCalendly, setNaHasCalendly] = useState<boolean | null>(null) // null = aún sin comprobar
  const [naCalendlyMsg, setNaCalendlyMsg] = useState('')
  const [naManualMode, setNaManualMode] = useState(false) // elegir hora libre aunque el closer tenga Calendly
  const [userTimezone, setUserTimezone] = useState<string>('Europe/Madrid')
  // Timezone del CONTACTO (no del closer): es la que se manda a Calendly como zona del invitado,
  // para que el lead reciba la confirmación/ICS en su hora real y no en la de quien agenda.
  const [naContactTimezone, setNaContactTimezone] = useState<string>(DEFAULT_TIMEZONE)

  // Detecta la timezone del navegador al montar el componente (solo para mostrarle al closer los
  // huecos de Calendly en su propia hora al elegir uno, no se usa para lo que ve el contacto)
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    setUserTimezone(tz || 'Europe/Madrid')
  }, [])

  // Al elegir/crear el contacto, adivina su timezone real (por prefijo telefónico o país); el
  // selector de la UI permite corregirla a mano si la estimación falla.
  useEffect(() => {
    setNaContactTimezone(guessContactTimezone(naSelectedContact))
  }, [naSelectedContact])

  // Batch: consulta los conflictos de closer para todos los contactos visibles de una sola vez
  // (no por fila) para no disparar N llamadas a la API.
  const fetchCloserConflicts = useCallback(
    async (appts: AppointmentWithRelations[]) => {
      const contactIds = Array.from(new Set(appts.map((a) => a.contact_id).filter((id): id is string => !!id)))
      if (contactIds.length === 0) {
        setCloserConflicts({})
        return
      }
      try {
        const res = await fetch(
          `/api/${tenant}/evergreen/appointments/closer-conflicts?contactIds=${contactIds.join(',')}`
        )
        const json = await res.json()
        if (res.ok) setCloserConflicts(json.conflicts || {})
      } catch {
        // No bloquea la carga de la tabla si esta alerta secundaria falla.
      }
    },
    [tenant]
  )

  const fetchData = useCallback(async () => {
    const supabase = createClient()

    // DOS VIAJES DE RED MENOS, EN SERIE. Aquí había un `auth.getUser()` (envuelto en un Promise.all de
    // un solo elemento, que no paraleliza nada) y después un `from('users')`, los dos releyendo lo que
    // app/[tenant]/layout.tsx acababa de traer para decidir si dejar entrar a esta pantalla. Y los dos
    // ANTES de poder pedir las agendas, que es el dato que la persona ha venido a ver.
    let role = ''
    let scope = 'own'
    const userId = sesion?.userId ?? null
    if (sesion) {
      const userData = sesion.user as { data_scope?: string; full_name?: string; roles?: { key?: string } | null }
      role = userData.roles?.key ?? ''
      scope = userData.data_scope ?? 'own'
      setCurrentUserRole(role)
      setCurrentUserScope(scope)
      setCurrentUserName(userData.full_name ?? '')
      setCurrentUserId(sesion.userId)
    }

    let appointmentsQuery = supabase
      .from('appointments')
      .select(`*, contacts(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name)`)
      .eq('tenant_id', tenantId)
      .order('appointment_datetime', { ascending: false })

    // Filtro por rol: liderazgo y quien tiene visibilidad de equipo (data_scope='team') ven todo;
    // el resto (scope 'own') solo lo suyo. Coherente con la RLS de SELECT y con los endpoints de
    // gestión/reprogramación, que ya respetan el scope 'team'.
    if (userId && role && !isLeadership(role as AppRole) && scope !== 'team') {
      if (role === 'closer') {
        appointmentsQuery = appointmentsQuery.eq('closer_id', userId)
      } else if (role === 'setter') {
        appointmentsQuery = appointmentsQuery.eq('setter_id', userId)
      }
    }

    const [appRes, usersRes, salesRes] = await Promise.all([
      appointmentsQuery,
      supabase.from('users').select('*, roles(key)').eq('is_active', true),
      supabase
        .from('sales')
        .select('id, contact_id, appointment_id, closer_id, setter_id, status, gross_amount')
        .eq('tenant_id', tenantId),
    ])

    if (appRes.error) {
      toast.error('Error al cargar agendas')
    } else {
      const appts = appRes.data as AppointmentWithRelations[]
      setAppointments(appts)
      fetchCloserConflicts(appts)
    }

    // Sin esto, un fallo de RLS en sales dejaba hasPurchased() calculado sobre un array vacío
    // en silencio: las citas con venta real dejaban de pintarse en verde ("compra") sin aviso.
    if (usersRes.error) toast.error('Error al cargar usuarios', { description: usersRes.error.message })
    if (salesRes.error) toast.error('Error al cargar ventas', { description: salesRes.error.message })
    setUsers(usersRes.data ?? [])
    setSales((salesRes.data as Sale[]) ?? [])
    setLoading(false)
  }, [sesion, tenantId, fetchCloserConflicts])

  useEffect(() => {
    fetchData()
    // `sesion` está memorizada en el layout, así que esto no entra en bucle: solo se vuelve a cargar si
    // de verdad cambia la sesión (cambio de subcuenta, relogin) — o cambia fetchData, misma condición.
  }, [sesion, fetchData])

  useEffect(() => {
    if (!showNewModal) return
    if (naContactSearch.trim().length < 2) {
      setNaContactResults([])
      return
    }
    setNaSearchLoading(true)
    const timer = setTimeout(async () => {
      const supabase = createClient()
      const q = naContactSearch.trim()
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('tenant_id', tenantId)
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(10)
      setNaContactResults(data ?? [])
      setNaSearchLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [naContactSearch, showNewModal, tenantId])

  // Carga los huecos reales del Calendly del closer para la fecha elegida.
  useEffect(() => {
    if (!showNewModal || !naCloserId || !naSlotDate) {
      setNaSlots([])
      return
    }
    let cancelled = false
    setNaSlotsLoading(true)
    setNaSelectedSlot('')
    setNaCalendlyMsg('')
    ;(async () => {
      try {
        const res = await fetch(
          `/api/${tenant}/evergreen/calendly/availability?closerId=${naCloserId}&date=${naSlotDate}`
        )
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setNaHasCalendly(null)
          setNaCalendlyMsg(json.error || 'No se pudieron cargar los huecos')
          setNaSlots([])
        } else if (json.hasCalendly === false) {
          setNaHasCalendly(false)
          setNaCalendlyMsg(json.reason || 'Este closer no tiene Calendly')
          setNaSlots([])
        } else {
          setNaHasCalendly(true)
          setNaSlots(json.slots || [])
          if (json.eventType?.duration) setNaDurationMinutes(String(json.eventType.duration))
        }
      } catch {
        if (!cancelled) {
          setNaCalendlyMsg('Error de red al cargar huecos')
          setNaSlots([])
        }
      } finally {
        if (!cancelled) setNaSlotsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showNewModal, naCloserId, naSlotDate, tenant])

  const resetNewAppointmentForm = () => {
    setNaContactSearch('')
    setNaContactResults([])
    setNaSelectedContact(null)
    setNaShowNewContactForm(false)
    setNaNewContactName('')
    setNaNewContactEmail('')
    setNaNewContactPhone('')
    setNaNewContactInstagram('')
    setNaDatetime('')
    setNaDurationMinutes('30')
    setNaSetterId('')
    setNaCloserId('')
    setNaSlotDate('')
    setNaSlots([])
    setNaSelectedSlot('')
    setNaSlotsLoading(false)
    setNaHasCalendly(null)
    setNaCalendlyMsg('')
    setNaManualMode(false)
  }

  const handleCreateContactInline = async () => {
    const name = naNewContactName.trim()
    if (!name) {
      toast.error('Ponle un nombre al contacto')
      return
    }
    if (!naNewContactEmail.trim() && !naNewContactPhone.trim()) {
      toast.error('Añade al menos un email o un teléfono')
      return
    }
    const parts = name.split(' ')
    const firstName = parts[0]
    const lastName = parts.slice(1).join(' ') || null

    // Vía API con service-role: contacts solo tiene política RLS de SELECT, un INSERT directo
    // desde el cliente lo bloqueaba en silencio para roles no-admin (0 filas, sin error).
    const res = await fetch(`/api/${tenant}/evergreen/contacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        email: naNewContactEmail.trim() || null,
        phone: naNewContactPhone.trim() || null,
        instagram: naNewContactInstagram.trim() || null,
      }),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.contact) {
      toast.error('Error al crear el contacto', { description: json?.error })
      return
    }

    toast.success('Contacto creado correctamente')
    setNaSelectedContact(json.contact)
    setNaShowNewContactForm(false)
    setNaContactSearch('')
    setNaContactResults([])
  }

  const handleCreateAppointment = async () => {
    if (!naSelectedContact) {
      toast.error('Selecciona o crea un contacto')
      return
    }

    const parsedDuration = parseInt(naDurationMinutes, 10)
    const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 30

    // Caso 1: el closer tiene Calendly y no se ha activado el modo manual → creamos también en
    // Calendly (bidireccional).
    if (naCloserId && naHasCalendly === true && !naManualMode) {
      if (!naSelectedContact.email) {
        toast.error('El contacto necesita un email para agendar en Calendly')
        return
      }
      if (!naSelectedSlot) {
        toast.error('Elige un hueco disponible de Calendly')
        return
      }
      setNaSaving(true)
      try {
        const res = await fetch(`/api/${tenant}/evergreen/appointments/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: naSelectedContact.id,
            closerId: naCloserId,
            setterId: naSetterId || null,
            startTime: naSelectedSlot,
            durationMinutes: duration,
            timezone: naContactTimezone,
          }),
        })
        const json = await res.json()
        if (!res.ok) {
          toast.error('No se pudo crear en Calendly', { description: json.error || json.detail })
          setNaSaving(false)
          return
        }
        if (json.warning) toast.warning(json.warning, { description: json.detail })
        else toast.success('Cita creada en Calendly y en la app')
      } catch {
        toast.error('Error de red al crear la cita')
        setNaSaving(false)
        return
      }
      setNaSaving(false)
      setShowNewModal(false)
      resetNewAppointmentForm()
      fetchData()
      return
    }

    // Caso 2: sin closer con Calendly → cita manual solo en la app (fallback).
    if (naCloserId && naHasCalendly === false) {
      toast.info('Este closer no tiene Calendly: la cita se crea solo en la app')
    }
    if (!naDatetime) {
      toast.error('Indica fecha y hora')
      return
    }
    setNaSaving(true)
    // Vía endpoint service-role: la RLS de INSERT en appointments solo deja a admin/director, así que
    // un setter/closer/manager no puede insertar la agenda manual directamente desde el cliente.
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: naSelectedContact.id,
          closerId: naCloserId || null,
          setterId: naSetterId || null,
          startTime: new Date(naDatetime).toISOString(),
          durationMinutes: duration,
          timezone: naContactTimezone,
          manual: true,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) throw new Error(json?.error || 'No se pudo crear la agenda')
    } catch (err) {
      setNaSaving(false)
      toast.error('Error al crear la agenda', { description: err instanceof Error ? err.message : undefined })
      return
    }
    setNaSaving(false)

    toast.success('Agenda creada correctamente')
    setShowNewModal(false)
    resetNewAppointmentForm()
    fetchData()
  }

  const setters = useMemo(
    () => users.filter((u) => (u as { roles?: { key?: string } }).roles?.key === 'setter'),
    [users]
  )
  // Un admin también puede coger llamadas (ej: [tenant]), así que se ofrece igual que un closer
  // a la hora de asignar/crear agendas.
  const closers = useMemo(
    () =>
      users.filter((u) => {
        const key = (u as { roles?: { key?: string } }).roles?.key
        return key === 'closer' || key === 'admin'
      }),
    [users]
  )

  // Posibles duplicadas: mismo contacto con más de una agenda EL MISMO DÍA. Es el patrón que dejan
  // las reagendas y los webhooks repetidos de Calendly/GHL (dos citas de la misma persona el mismo
  // día, a horas distintas), y el que infla shows/no-shows en los KPIs. Dos citas en días distintos
  // son legítimas (dos llamadas), así que no se marcan.
  const duplicateIds = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const a of appointments) {
      if (!a.contact_id || !a.appointment_datetime) continue
      const d = new Date(a.appointment_datetime)
      const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
      const key = `${a.contact_id}|${day}`
      const arr = groups.get(key)
      if (arr) arr.push(a.id)
      else groups.set(key, [a.id])
    }
    const dupes = new Set<string>()
    for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id) => dupes.add(id))
    return dupes
  }, [appointments])

  const tableDateRange = useMemo(() => getPeriodRange('custom', dateFrom, dateTo), [dateFrom, dateTo])

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (onlyDuplicates && !duplicateIds.has(a.id)) return false
      if (onlyFollowUp && !a.needs_followup) return false
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (channelFilter === 'instagram' && a.utm_source !== 'instagram-setting') return false
      if (channelFilter === 'facebook' && a.utm_source !== 'facebook-setting') return false
      if (channelFilter === 'other' && ['instagram-setting', 'facebook-setting'].includes(a.utm_source || ''))
        return false
      if (setterFilter !== 'all' && a.setter_id !== setterFilter) return false
      if (closerFilter !== 'all' && a.closer_id !== closerFilter) return false
      if ((dateFrom || dateTo) && !inPeriod(a.appointment_datetime, tableDateRange)) return false
      const normalizedSearch = normalizeText(search.trim())
      if (normalizedSearch) {
        const contact = a.contacts
        if (
          !normalizeText(contact?.full_name || '').includes(normalizedSearch) &&
          !normalizeText(contact?.email || '').includes(normalizedSearch) &&
          !phoneMatches(contact?.phone, search)
        )
          return false
      }
      return true
    })
  }, [
    appointments,
    statusFilter,
    channelFilter,
    setterFilter,
    closerFilter,
    dateFrom,
    dateTo,
    tableDateRange,
    search,
    onlyDuplicates,
    duplicateIds,
    onlyFollowUp,
  ])

  const hasTableFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    channelFilter !== 'all' ||
    setterFilter !== 'all' ||
    closerFilter !== 'all' ||
    !!dateFrom ||
    !!dateTo ||
    onlyDuplicates ||
    onlyFollowUp

  const clearTableFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setChannelFilter('all')
    setSetterFilter('all')
    setCloserFilter('all')
    setDateFrom('')
    setDateTo('')
    setOnlyDuplicates(false)
    setOnlyFollowUp(false)
  }

  // Días de la semana actual (Lun..Dom)
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const pxPerHour = calMode === 'day' ? 88 : PX_PER_HOUR

  // Columnas del calendario:
  //  · semana → una por día (7)
  //  · día    → una LANE por closer seleccionado (estilo GHL); cada columna muestra las agendas de
  //             ese closer ese día. Vacío = todos los closers.
  type CalColumn = { key: string; label: string; sub: string; date: Date; closerId: string | null; today: boolean }
  const calColumns = useMemo<CalColumn[]>(() => {
    if (calMode === 'day') {
      const d = weekStart
      const today = isSameDay(d, new Date())
      const chosen = dayCloserIds.length ? closers.filter((c) => dayCloserIds.includes(c.id)) : closers
      if (chosen.length === 0)
        return [{ key: 'all', label: 'Sin closer asignado', sub: '', date: d, closerId: null, today }]
      return chosen.map((c) => ({ key: c.id, label: c.full_name, sub: 'Closer', date: d, closerId: c.id, today }))
    }
    return weekDays.map((d, i) => ({
      key: String(i),
      label: DAY_NAMES[(d.getDay() + 6) % 7],
      sub: String(d.getDate()),
      date: d,
      closerId: null,
      today: isSameDay(d, new Date()),
    }))
  }, [calMode, weekStart, weekDays, dayCloserIds, closers])

  // Agendas visibles en el calendario, filtradas por closer/setter seleccionado (solo liderazgo).
  // Una cita 'rescheduled' (reagendada) normalmente tiene una réplica ACTIVA en el hueco nuevo, y
  // por eso se oculta: mostrar ambas dibujaba dos eventos con el mismo nombre (la vieja + la nueva).
  // PERO si por un fallo de sincronización esa réplica no existe (p.ej. Calendly entregó solo el
  // invitee.canceled del reschedule y no llegó/erró el invitee.created de la nueva hora), ocultarla
  // hacía DESAPARECER la agenda del calendario aunque siguiera en la tabla. Por eso solo ocultamos
  // una 'rescheduled' cuando hay otra cita activa (no reagendada ni cancelada) para el mismo contacto.
  const calendarAppointments = useMemo(() => {
    const contactosConReplicaActiva = new Set(
      appointments
        .filter((a) => a.contact_id && a.status !== 'rescheduled' && a.status !== 'cancelled_lead')
        .map((a) => a.contact_id)
    )
    const visible = appointments.filter(
      (a) => a.status !== 'rescheduled' || !contactosConReplicaActiva.has(a.contact_id)
    )
    if (calMode === 'day' || calendarUserFilter === 'all') return visible
    return visible.filter((a) => a.closer_id === calendarUserFilter || a.setter_id === calendarUserFilter)
  }, [appointments, calendarUserFilter, calMode])

  // Agrupa las agendas de la semana visible por día, con posición/altura proporcional a la duración
  const calendarGrid = useMemo(() => {
    const weekEnd = addDays(weekStart, calMode === 'day' ? 1 : 7)
    const firstHour = CALENDAR_HOURS[0]
    type Slot = { appt: AppointmentWithRelations; top: number; height: number; colIndex: number; colCount: number }
    const grid = new Map<number, Slot[]>()
    for (const appt of calendarAppointments) {
      const dt = new Date(appt.appointment_datetime)
      if (dt < weekStart || dt >= weekEnd) continue
      const dayIdx = calColumns.findIndex(
        (col) => isSameDay(col.date, dt) && (col.closerId === null || col.closerId === appt.closer_id)
      )
      if (dayIdx === -1) continue
      const minutesFromStart = (dt.getHours() - firstHour) * 60 + dt.getMinutes()
      const durationMinutes = appt.duration_minutes ?? 60
      // Clamp al contenedor del grid: una cita fuera del rango visible (p.ej. 07:30 cuando la
      // rejilla empieza a las 08:00) recibía top negativo o mayor que la altura y se pintaba
      // fuera de su columna, por encima de la cabecera o de la fila siguiente.
      const gridHeight = pxPerHour * CALENDAR_HOURS.length
      const top = Math.min(Math.max((minutesFromStart / 60) * pxPerHour, 0), gridHeight - 20)
      const height = Math.min(Math.max((durationMinutes / 60) * pxPerHour, 20), gridHeight - top)
      const arr = grid.get(dayIdx) ?? []
      arr.push({ appt, top, height, colIndex: 0, colCount: 1 })
      grid.set(dayIdx, arr)
    }
    // Reparte en columnas lado a lado las agendas que se solapan (estilo Google Calendar) para que
    // TODAS se vean, aunque coincidan a la misma hora (p.ej. una cancelada y otra nueva).
    grid.forEach((arr) => {
      arr.sort((a, b) => a.top - b.top || a.height - b.height)
      let cluster: Slot[] = []
      let clusterBottom = -1
      const flush = () => {
        if (!cluster.length) return
        const colEnds: number[] = [] // fondo (top+height) del último item de cada columna
        for (const it of cluster) {
          let c = colEnds.findIndex((end) => it.top >= end - 0.01)
          if (c === -1) {
            c = colEnds.length
            colEnds.push(0)
          }
          colEnds[c] = it.top + it.height
          it.colIndex = c
        }
        cluster.forEach((it) => {
          it.colCount = colEnds.length
        })
        cluster = []
      }
      for (const it of arr) {
        if (cluster.length && it.top >= clusterBottom - 0.01) {
          flush()
          clusterBottom = -1
        }
        cluster.push(it)
        clusterBottom = Math.max(clusterBottom, it.top + it.height)
      }
      flush()
    })
    return grid
  }, [calendarAppointments, weekStart, calMode, calColumns, pxPerHour])

  // Datos para la vista de análisis IA
  const analyzedAppointments = useMemo(() => {
    return appointments
      .filter((a) => a.ai_analyzed_at)
      .sort((a, b) => new Date(b.ai_analyzed_at as string).getTime() - new Date(a.ai_analyzed_at as string).getTime())
  }, [appointments])

  const pendingAnalysisAppointments = useMemo(() => {
    return appointments.filter(
      (a) => !a.ai_analyzed_at && (a.transcript_status === 'procesando' || a.transcript_status === 'error')
    )
  }, [appointments])

  const aiKpis = useMemo(() => {
    const analyzed = analyzedAppointments
    const count = analyzed.length
    const callScores = analyzed.map((a) => a.ai_call_score).filter((v): v is number => v !== null && v !== undefined)
    const leadScores = analyzed.map((a) => a.ai_lead_score).filter((v): v is number => v !== null && v !== undefined)
    const avgCall = callScores.length ? callScores.reduce((s, v) => s + v, 0) / callScores.length : null
    const avgLead = leadScores.length ? leadScores.reduce((s, v) => s + v, 0) / leadScores.length : null
    return { count, avgCall, avgLead }
  }, [analyzedAppointments])

  const SHOW_STATUSES: AppointmentStatus[] = ['show', 'completed']
  const NO_SHOW_STATUSES: AppointmentStatus[] = ['no_show']

  // Contactos / agendas con una VENTA activa. Sirve para pintar la agenda y el calendario en
  // verde con estado "Comprado" cuando la persona ya ha comprado. Enlazamos por appointment_id
  // (venta ligada a la cita) y, como respaldo, por contact_id (el contacto compró en cualquier cita).
  const purchased = useMemo(() => {
    const byContact = new Set<string>()
    const byAppointment = new Set<string>()
    for (const s of sales) {
      if (s.status !== 'active') continue
      if (s.contact_id) byContact.add(s.contact_id)
      if (s.appointment_id) byAppointment.add(s.appointment_id)
    }
    return { byContact, byAppointment }
  }, [sales])

  const hasPurchased = useCallback(
    (a: { id: string; contact_id: string | null }): boolean =>
      purchased.byAppointment.has(a.id) || (a.contact_id != null && purchased.byContact.has(a.contact_id)),
    [purchased]
  )

  // Solo admin/director pueden reasignar desde el aviso de conflicto de closer (afecta comisiones).
  // Declarado AQUÍ (y no junto a los otros flags de rol más abajo) para que el useMemo de columnas
  // pueda depender de ambos sin TDZ.
  const canReassignConflict = ['admin', 'director'].includes(currentUserRole)

  const handleReassignConflict = useCallback(
    async (appointmentId: string, closerId: string) => {
      setReassigningConflictId(appointmentId)
      try {
        const res = await fetch(`/api/${tenant}/evergreen/appointments/reassign-closer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointmentId, closerId }),
        })
        const json = await res.json()
        if (!res.ok || json?.error) throw new Error(json?.error || 'No se pudo reasignar el closer')
        toast.success('Closer reasignado')
        await fetchData()
      } catch (err) {
        toast.error('No se pudo reasignar el closer', { description: err instanceof Error ? err.message : undefined })
      } finally {
        setReassigningConflictId(null)
      }
    },
    [tenant, fetchData]
  )

  // Periodo de la vista "Métricas": permite comparar el tramo elegido con el inmediatamente
  // anterior de igual duración (mes vs mes pasado, día vs día pasado...) para tener referencia.
  const [metricsPeriodPreset, setMetricsPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [metricsCustomFrom, setMetricsCustomFrom] = useState('')
  const [metricsCustomTo, setMetricsCustomTo] = useState('')
  const metricsRange = useMemo(
    () => getPeriodRange(metricsPeriodPreset, metricsCustomFrom, metricsCustomTo),
    [metricsPeriodPreset, metricsCustomFrom, metricsCustomTo]
  )
  const metricsPrevRange = useMemo(() => getPreviousPeriodRange(metricsRange), [metricsRange])

  const computeSetterMetrics = (source: AppointmentWithRelations[]) =>
    setters.map((u) => {
      const agendas = source.filter((a) => a.setter_id === u.id)
      const shows = agendas.filter((a) => SHOW_STATUSES.includes(a.status)).length
      const noShows = agendas.filter((a) => NO_SHOW_STATUSES.includes(a.status)).length
      const programadas = agendas.filter(
        (a) => getAppointmentCategory(a.status, hasPurchased(a)) === 'programada'
      ).length
      const seguimientos = agendas.filter((a) => a.needs_followup).length
      const showRate = agendas.length > 0 ? (shows / agendas.length) * 100 : null
      return {
        id: u.id,
        name: u.full_name,
        agendas: agendas.length,
        shows,
        noShows,
        programadas,
        seguimientos,
        showRate,
      }
    })

  const computeCloserMetrics = (apptSource: AppointmentWithRelations[], salesSource: Sale[]) =>
    closers.map((u) => {
      const asignadas = apptSource.filter((a) => a.closer_id === u.id)
      const showsAtendidos = asignadas.filter((a) => SHOW_STATUSES.includes(a.status)).length
      const programadas = asignadas.filter(
        (a) => getAppointmentCategory(a.status, hasPurchased(a)) === 'programada'
      ).length
      const seguimientos = asignadas.filter((a) => a.needs_followup).length
      const ventasCloser = salesSource.filter((s) => s.closer_id === u.id && s.status === 'active')
      const cierres = ventasCloser.length
      const ingresos = ventasCloser.reduce((sum, s) => sum + (s.gross_amount || 0), 0)
      const closeRate = showsAtendidos > 0 ? (cierres / showsAtendidos) * 100 : null
      return {
        id: u.id,
        name: u.full_name,
        asignadas: asignadas.length,
        showsAtendidos,
        cierres,
        closeRate,
        ingresos,
        programadas,
        seguimientos,
      }
    })

  const metricsAppointments = useMemo(
    () =>
      metricsPeriodPreset === 'all'
        ? appointments
        : appointments.filter((a) => inPeriod(a.appointment_datetime, metricsRange)),
    [appointments, metricsPeriodPreset, metricsRange]
  )
  const metricsSales = useMemo(
    () => (metricsPeriodPreset === 'all' ? sales : sales.filter((s) => inPeriod(s.sale_date, metricsRange))),
    [sales, metricsPeriodPreset, metricsRange]
  )
  const prevMetricsAppointments = useMemo(
    () => appointments.filter((a) => inPeriod(a.appointment_datetime, metricsPrevRange)),
    [appointments, metricsPrevRange]
  )
  const prevMetricsSales = useMemo(
    () => sales.filter((s) => inPeriod(s.sale_date, metricsPrevRange)),
    [sales, metricsPrevRange]
  )

  const setterMetrics = useMemo(
    () => computeSetterMetrics(metricsAppointments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setters, metricsAppointments, purchased]
  )
  const closerMetrics = useMemo(
    () => computeCloserMetrics(metricsAppointments, metricsSales),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closers, metricsAppointments, metricsSales, purchased]
  )
  const hasPrevPeriod = metricsPeriodPreset !== 'all' && metricsPrevRange.from !== null
  const prevSetterMetrics = useMemo(
    () => (hasPrevPeriod ? computeSetterMetrics(prevMetricsAppointments) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setters, prevMetricsAppointments, purchased, hasPrevPeriod]
  )
  const prevCloserMetrics = useMemo(
    () => (hasPrevPeriod ? computeCloserMetrics(prevMetricsAppointments, prevMetricsSales) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closers, prevMetricsAppointments, prevMetricsSales, purchased, hasPrevPeriod]
  )

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

  // Reprograma una agenda vía drag & drop en el calendario (mismo endpoint que el panel de detalle).
  // Optimista: actualiza el estado local al soltar y revierte si el servidor falla.
  const rescheduleAppointment = async (appt: AppointmentWithRelations, newStartISO: string) => {
    const prevDatetime = appt.appointment_datetime
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === appt.id ? { ...a, appointment_datetime: newStartISO, status: 'scheduled' as AppointmentStatus } : a
      )
    )
    const doReschedule = async (manualOnly: boolean) => {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appt.id,
          startTime: newStartISO,
          durationMinutes: appt.duration_minutes || undefined,
          timezone: guessContactTimezone(appt.contacts),
          manualOnly,
        }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo reprogramar')
      return data
    }
    try {
      let data
      try {
        data = await doReschedule(false)
      } catch (calendlyErr) {
        // Si Calendly rechaza el movimiento (evento pasado, slot inválido, rate limit...) no
        // dejamos la agenda "atascada" revirtiéndola sin más: reintentamos SOLO en la plataforma
        // (lo que el equipo pide como "reprogramación libre") y avisamos que hay que moverla a
        // mano en Calendly si hace falta mantenerla sincronizada.
        data = await doReschedule(true)
        toast.warning('Agenda movida solo en la plataforma', {
          description: `Calendly rechazó el cambio (${calendlyErr instanceof Error ? calendlyErr.message : 'motivo desconocido'}) — muévela también a mano en Calendly/Google Calendar si aplica.`,
        })
        return
      }
      if (data?.calendlyCanceled === false) {
        toast.warning('Agenda reprogramada, pero el evento antiguo sigue en Calendly/Google Calendar', {
          description:
            'No se pudo cancelar el evento anterior automáticamente. Bórralo a mano para evitar un duplicado.',
        })
      } else {
        toast.success('Agenda reprogramada')
      }
    } catch (err) {
      // Revertir
      setAppointments((prev) => prev.map((a) => (a.id === appt.id ? { ...a, appointment_datetime: prevDatetime } : a)))
      toast.error('No se pudo reprogramar', { description: err instanceof Error ? err.message : undefined })
    }
  }

  const canDragAppointment = (appt: AppointmentWithRelations): boolean => {
    if (isLeadership(currentUserRole as AppRole)) return true
    // Con visibilidad de equipo (data_scope='team') puede reprogramar cualquier agenda del equipo,
    // igual que el backend. El resto (scope 'own'), solo las suyas.
    if (currentUserScope === 'team') return true
    return appt.closer_id === currentUserId || appt.setter_id === currentUserId
  }

  // Hora actual, para la línea "ahora" del calendario (se refresca cada minuto).
  const [nowTick, setNowTick] = useState<Date>(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Id de la agenda que se está arrastrando en el calendario (drag & drop para reprogramar).
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Origen del drag nativo, para distinguir un click real (micro-jitter de trackpad) de un arrastre intencional.
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const DRAG_MIN_DISTANCE_PX = 8

  // Orden de la vista "tabla": por defecto, las últimas agendas RESERVADAS primero
  // (created_at desc), no la fecha del evento — para ver rápido lo que va entrando.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }])

  const columns = useMemo(
    () => [
      columnHelper.accessor('created_at', {
        header: 'Reservado el',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{formatDateTime(getValue())}</span>,
      }),
      columnHelper.accessor('appointment_datetime', {
        header: 'Fecha/Hora',
        cell: ({ getValue }) => <span className="text-foreground text-sm">{formatDateTime(getValue())}</span>,
      }),
      columnHelper.display({
        id: 'contact',
        header: 'Contacto',
        cell: ({ row }) => (
          <button
            className="text-brand-400 hover:text-brand-300 text-sm font-medium"
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/${tenant}/crm/contactos/${row.original.contact_id}`)
            }}
          >
            {row.original.contacts?.full_name || '—'}
          </button>
        ),
      }),
      columnHelper.display({
        id: 'setter',
        header: 'Setter',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.setter?.full_name || '—'}</span>
        ),
      }),
      columnHelper.display({
        id: 'closer',
        header: 'Closer',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.closer?.full_name || '—'}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ getValue, row }) => {
          const s = getValue()
          const category = getAppointmentCategory(s, hasPurchased(row.original))
          const conflict = row.original.contact_id ? closerConflicts[row.original.contact_id] : undefined
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className={`border text-xs gap-1 ${CATEGORY_BADGE_CLASSES[category]}`}>
                {category === 'compra' && <Banknote className="w-3 h-3" />}
                {CATEGORY_LABELS[category]}
              </Badge>
              {row.original.needs_followup ? (
                <Badge className="border text-xs bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                  Seguimiento
                </Badge>
              ) : null}
              {isNoShow(row.original.rescheduled_from_status) && (
                <Badge className="border text-xs bg-red-500/10 text-red-400 border-red-500/30">
                  Reagenda / No show
                </Badge>
              )}
              {row.original.rescheduled_from_status === 'show' && (
                <Badge className="border text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  Reagenda / Show
                </Badge>
              )}
              {conflict && (
                <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  <Badge
                    className="border text-xs bg-amber-500/20 text-amber-400 border-amber-500/30"
                    title="Este contacto ya fue atendido por otro closer en una cita anterior"
                  >
                    ⚠ Ya atendido por {conflict.owning_closer_name}
                  </Badge>
                  {canReassignConflict && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-amber-700/60 text-amber-400 hover:bg-amber-500/10"
                      disabled={reassigningConflictId === conflict.conflicting_appointment_id}
                      onClick={() =>
                        handleReassignConflict(conflict.conflicting_appointment_id, conflict.owning_closer_id)
                      }
                    >
                      Reasignar a {conflict.owning_closer_name}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor('source', {
        header: 'Fuente',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{getValue() || '—'}</span>,
      }),
      // Origen del lead: la IA (Instagram/Facebook Setting) marca sus propios leads con
      // utm_source 'instagram-setting'/'facebook-setting' + utm_term conteniendo "IA".
      // El resto de UTMs son campañas de pago normales; sin UTM = orgánico/referido.
      columnHelper.display({
        id: 'origin',
        header: 'Origen',
        cell: ({ row }) => {
          const a = row.original
          const isIA =
            ['instagram-setting', 'facebook-setting'].includes(a.utm_source || '') &&
            (a.utm_term || '').toUpperCase().includes('IA')
          const utm = a.utm_source || a.utm_campaign
          const fullTooltip = [
            a.utm_source && `source: ${a.utm_source}`,
            a.utm_medium && `medium: ${a.utm_medium}`,
            a.utm_campaign && `campaign: ${a.utm_campaign}`,
            a.utm_content && `content: ${a.utm_content}`,
            a.utm_term && `term: ${a.utm_term}`,
          ]
            .filter(Boolean)
            .join(' · ')
          if (isIA) {
            return (
              <Badge
                className="border text-xs bg-violet-500/20 text-violet-300 border-violet-500/30"
                title={fullTooltip}
              >
                IA{a.utm_source === 'instagram-setting' ? ' (IG)' : a.utm_source === 'facebook-setting' ? ' (FB)' : ''}
              </Badge>
            )
          }
          return utm ? (
            <Badge className="border text-xs bg-sky-500/20 text-sky-300 border-sky-500/30" title={fullTooltip}>
              UTM{a.utm_source ? `: ${a.utm_source}` : ''}
            </Badge>
          ) : (
            <Badge className="border text-xs bg-zinc-500/20 text-muted-foreground border-border/30">Sin UTM</Badge>
          )
        },
      }),
      columnHelper.accessor('utm_campaign', {
        header: 'UTM Campaign',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{getValue() || '—'}</span>,
      }),
      columnHelper.accessor('utm_medium', {
        header: 'UTM Medium',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{getValue() || '—'}</span>,
      }),
      columnHelper.accessor('utm_content', {
        header: 'UTM Content',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{getValue() || '—'}</span>,
      }),
    ],
    [closerConflicts, reassigningConflictId, canReassignConflict, handleReassignConflict, hasPurchased, router, tenant]
  )

  const table = useReactTable({
    data: filteredAppointments,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: coreRowModel,
    getSortedRowModel: sortedRowModel,
    getFilteredRowModel: filteredRowModel,
  })

  // Closers/setters (y cold callers) pueden marcar asistencia/estado de SUS agendas; el endpoint
  // server-side valida que sea su propia agenda. Liderazgo puede con todas.
  const canChangeStatus = ['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(currentUserRole)
  // Borrar agendas es exclusivo de admin: es lo único que hace que dejen de contar en los KPIs.
  const isAdmin = currentUserRole === 'admin'
  // canReassignConflict y handleReassignConflict se declaran junto a hasPurchased (arriba):
  // el useMemo de columnas depende de ellos.

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agendas</h1>
          <p className="text-muted-foreground text-sm mt-1">Todas las citas y reuniones</p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="bg-brand-600 hover:bg-brand-500">
          <Plus className="w-4 h-4 mr-2" />
          Nueva agenda
        </Button>
      </div>

      {/* View switcher */}
      <div className="flex flex-wrap items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit max-w-full">
        <button
          onClick={() => setView('tabla')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'tabla' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Table2 className="w-4 h-4" />
          Tabla
        </button>
        <button
          onClick={() => setView('calendario')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'calendario' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          Calendario
        </button>
        <button
          onClick={() => setView('analisis')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'analisis' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Análisis IA
        </button>
        <button
          onClick={() => setView('metricas')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'metricas' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <UsersIcon className="w-4 h-4" />
          Métricas equipo
        </button>
      </div>

      {view === 'tabla' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Buscar por nombre, email o teléfono..."
              className="flex-1 min-w-[200px]"
            />

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 bg-card border-border">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-40 bg-card border-border">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Todos los canales</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="other">Otros</SelectItem>
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

            {/* Duplicadas: solo aparece si hay alguna. El admin las abre y las borra desde el detalle. */}
            {duplicateIds.size > 0 && (
              <Button
                variant={onlyDuplicates ? 'default' : 'outline'}
                onClick={() => setOnlyDuplicates((v) => !v)}
                className={
                  onlyDuplicates
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'border-amber-700/60 text-amber-400 hover:bg-amber-500/10'
                }
                title="Mismo contacto con más de una agenda el mismo día"
              >
                <Copy className="w-4 h-4 mr-1.5" />
                Posibles duplicadas ({duplicateIds.size})
              </Button>
            )}

            {appointments.some((a) => a.needs_followup) && (
              <Button
                variant={onlyFollowUp ? 'default' : 'outline'}
                onClick={() => setOnlyFollowUp((v) => !v)}
                className={
                  onlyFollowUp
                    ? 'bg-indigo-600 hover:bg-indigo-500'
                    : 'border-indigo-700/60 text-indigo-300 hover:bg-indigo-500/10'
                }
                title="Agendas marcadas en seguimiento"
              >
                En seguimiento ({appointments.filter((a) => a.needs_followup).length})
              </Button>
            )}
            {hasTableFilters && (
              <Button
                variant="ghost"
                onClick={clearTableFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4 mr-1.5" /> Limpiar filtros
              </Button>
            )}
          </div>

          {onlyDuplicates && (
            <p className="text-xs text-amber-400/90">
              Mostrando contactos con más de una agenda el mismo día (revisa antes: dos llamadas reales también salen
              aquí). Abre la que sobra y{' '}
              {isAdmin
                ? 'bórrala con «Borrar duplicada» para que deje de contar en los KPIs.'
                : 'pide a un admin que la borre: solo dirección puede hacerlo.'}
            </p>
          )}

          {/* Table */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id} className="border-border hover:bg-transparent">
                      {hg.headers.map((h) => {
                        const canSort = h.column.getCanSort()
                        const sortDir = h.column.getIsSorted()
                        return (
                          <TableHead key={h.id} className="text-muted-foreground">
                            {canSort ? (
                              <button
                                type="button"
                                onClick={h.column.getToggleSortingHandler()}
                                className="flex items-center gap-1 hover:text-foreground"
                              >
                                {flexRender(h.column.columnDef.header, h.getContext())}
                                {sortDir === 'asc' ? (
                                  <ArrowUp className="w-3 h-3" />
                                ) : sortDir === 'desc' ? (
                                  <ArrowDown className="w-3 h-3" />
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 opacity-40" />
                                )}
                              </button>
                            ) : (
                              flexRender(h.column.columnDef.header, h.getContext())
                            )}
                          </TableHead>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="text-center py-12">
                        <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">No se encontraron agendas</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="border-border hover:bg-card/50 cursor-pointer"
                        onClick={() => {
                          setSelectedAppointment(row.original)
                          setSheetOpen(true)
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{filteredAppointments.length} agendas</p>
        </>
      )}

      {view === 'calendario' && (
        <div className="space-y-4">
          {/* Navegación de semana */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Toggle Día / Semana */}
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  className={`px-3 py-1.5 text-sm ${calMode === 'day' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => {
                    setCalMode('day')
                    setWeekStart(startOfDay(new Date()))
                  }}
                >
                  Día
                </button>
                <button
                  className={`px-3 py-1.5 text-sm ${calMode === 'week' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => {
                    setCalMode('week')
                    setWeekStart((prev) => getMondayOfWeek(prev))
                  }}
                >
                  Semana
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-border text-foreground"
                onClick={() => setWeekStart((prev) => addDays(prev, calMode === 'day' ? -1 : -7))}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {calMode === 'day' ? 'Día anterior' : 'Semana anterior'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-border text-foreground"
                onClick={() => setWeekStart(calMode === 'day' ? startOfDay(new Date()) : getMondayOfWeek(new Date()))}
              >
                Hoy
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-border text-foreground"
                onClick={() => setWeekStart((prev) => addDays(prev, calMode === 'day' ? 1 : 7))}
              >
                {calMode === 'day' ? 'Día siguiente' : 'Semana siguiente'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {calMode === 'week' && (isLeadership(currentUserRole as AppRole) || currentUserScope === 'team') && (
                <Select value={calendarUserFilter} onValueChange={setCalendarUserFilter}>
                  <SelectTrigger className="w-48 bg-card border-border">
                    <SelectValue placeholder="Todo el equipo" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">Todo el equipo</SelectItem>
                    {closers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name} (closer)
                      </SelectItem>
                    ))}
                    {setters.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name} (setter)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-sm text-muted-foreground whitespace-nowrap">
                {calMode === 'day'
                  ? formatDate(weekStart.toISOString())
                  : `${formatDate(weekDays[0].toISOString())} — ${formatDate(weekDays[6].toISOString())}`}
              </p>
            </div>
          </div>

          {/* Modo día: elige qué closers ver como columnas (lanes). Vacío = todos. */}
          {calMode === 'day' && closers.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Closers:</span>
              {closers.map((c) => {
                const on = dayCloserIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => setDayCloserIds((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      on
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-card text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {c.full_name}
                  </button>
                )
              })}
              {dayCloserIds.length > 0 && (
                <button
                  onClick={() => setDayCloserIds([])}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Ver todos
                </button>
              )}
            </div>
          )}

          {/* Grid semanal / diario */}
          <div className="rounded-lg border border-border overflow-x-auto">
            <div style={{ minWidth: calMode === 'day' ? 60 + calColumns.length * 220 : 1400 }}>
              {/* Cabecera: días (semana) o closers (día) */}
              <div
                className="grid border-b border-border"
                style={{ gridTemplateColumns: `60px repeat(${calColumns.length}, 1fr)` }}
              >
                <div className="p-2" />
                {calColumns.map((col) => (
                  <div
                    key={col.key}
                    className={`p-2 text-center border-l border-border ${col.today ? 'bg-brand-500/10' : ''}`}
                  >
                    <p className={`text-sm font-semibold truncate ${col.today ? 'text-brand-400' : 'text-foreground'}`}>
                      {col.label}
                    </p>
                    {col.sub && <p className="text-xs text-muted-foreground">{col.sub}</p>}
                  </div>
                ))}
              </div>

              {/* Cuerpo: columna de horas + columnas (días o closers) con eventos posicionados en absoluto */}
              <div className="grid" style={{ gridTemplateColumns: `60px repeat(${calColumns.length}, 1fr)` }}>
                {/* Columna de horas */}
                <div>
                  {CALENDAR_HOURS.map((hour) => (
                    <div
                      key={hour}
                      style={{ height: `${pxPerHour}px` }}
                      className="p-2 text-xs text-muted-foreground text-right pr-3 border-b border-border last:border-b-0"
                    >
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {/* Columnas (días o closers) */}
                {calColumns.map((col, dayIdx) => {
                  const dayAppointments = calendarGrid.get(dayIdx) ?? []
                  // Línea "ahora" (estilo Google Calendar): solo en la columna de hoy.
                  const firstHour = CALENDAR_HOURS[0]
                  const lastHour = CALENDAR_HOURS[CALENDAR_HOURS.length - 1] + 1
                  const nowHours = nowTick.getHours() + nowTick.getMinutes() / 60
                  const showNowLine = col.today && nowHours >= firstHour && nowHours <= lastHour
                  const nowTop = (nowHours - firstHour) * pxPerHour

                  return (
                    <div
                      key={dayIdx}
                      className="relative border-l border-border"
                      style={{ height: `${pxPerHour * CALENDAR_HOURS.length}px` }}
                      onDragOver={(e) => {
                        if (!draggingId) return
                        e.preventDefault()
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (!draggingId) return
                        const id = draggingId
                        const origin = dragOriginRef.current
                        setDraggingId(null)
                        dragOriginRef.current = null
                        const appt = appointments.find((a) => a.id === id)
                        if (!appt) return
                        if (origin) {
                          const distance = Math.hypot(e.clientX - origin.x, e.clientY - origin.y)
                          if (distance < DRAG_MIN_DISTANCE_PX) {
                            // Micro-jitter de trackpad: era un click, no un arrastre. El navegador
                            // suprime el onClick nativo tras un dragstart, así que abrimos el detalle aquí.
                            setSelectedAppointment(appt)
                            setSheetOpen(true)
                            return
                          }
                        }
                        if (!canDragAppointment(appt)) {
                          toast.error('Solo puedes reprogramar tus propias agendas')
                          return
                        }
                        const rect = e.currentTarget.getBoundingClientRect()
                        const offsetY = e.clientY - rect.top
                        let hoursFromStart = offsetY / pxPerHour
                        // Snap a 15 minutos
                        hoursFromStart = Math.round(hoursFromStart * 4) / 4
                        const newDate = new Date(col.date)
                        newDate.setHours(firstHour, 0, 0, 0)
                        newDate.setMinutes(newDate.getMinutes() + hoursFromStart * 60)
                        rescheduleAppointment(appt, newDate.toISOString())
                      }}
                    >
                      {/* Líneas horizontales de fondo por hora */}
                      {CALENDAR_HOURS.map((hour) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 border-b border-border"
                          style={{ top: `${(hour - CALENDAR_HOURS[0]) * pxPerHour}px`, height: `${pxPerHour}px` }}
                        />
                      ))}

                      {/* Barra "ahora" */}
                      {showNowLine && (
                        <div
                          className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
                          style={{ top: `${nowTop}px` }}
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-pink-500 -ml-[3px]" />
                          <div className="flex-1 h-[2px] bg-gradient-to-r from-pink-500 to-brand-500" />
                        </div>
                      )}

                      {dayAppointments.map(({ appt, top, height, colIndex, colCount }) => {
                        const category = getAppointmentCategory(appt.status, hasPurchased(appt))
                        const isCancelled = category === 'cancelada'
                        const draggable = !isCancelled && canDragAppointment(appt)
                        // Contenido adaptativo a la altura real del bloque: el formato completo ocupa
                        // ~76px, así que en semana (52px/h) una card de 60 min no cabe y sus líneas
                        // se salían tapando la cita de abajo. xs = 1 línea, sm = 2 líneas, full = todo.
                        // La categoría la sigue comunicando el color del bloque y el tooltip.
                        const tier = height < 46 ? 'xs' : height < 84 ? 'sm' : 'full'
                        return (
                          <button
                            key={appt.id}
                            draggable={draggable}
                            onDragStart={(e) => {
                              setDraggingId(appt.id)
                              dragOriginRef.current = { x: e.clientX, y: e.clientY }
                              e.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={() => {
                              setDraggingId(null)
                              dragOriginRef.current = null
                            }}
                            onClick={() => {
                              setSelectedAppointment(appt)
                              setSheetOpen(true)
                            }}
                            title={`${new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(appt.appointment_datetime))} · ${appt.contacts?.full_name || '—'} · Closer: ${appt.closer?.full_name || 'Sin closer'} · ${CATEGORY_LABELS[category]}`}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${(colIndex / colCount) * 100}% + 2px)`,
                              width: `calc(${(1 / colCount) * 100}% - 4px)`,
                            }}
                            className={`absolute text-left border rounded overflow-hidden transition-colors ${
                              tier === 'xs' ? 'px-2 py-0.5' : tier === 'sm' ? 'px-2 py-1' : 'px-2 py-1.5'
                            } ${
                              draggable ? 'cursor-grab active:cursor-grabbing' : ''
                            } ${CATEGORY_BLOCK_CLASSES[category]} ${isCancelled ? 'z-10' : 'z-20'} ${appt.needs_followup ? 'ring-2 ring-indigo-400/70' : ''}`}
                          >
                            {tier !== 'full' ? (
                              <p className="text-[11px] leading-none text-foreground truncate flex items-center gap-1">
                                {category === 'compra' && (
                                  <Banknote className="w-3 h-3 text-green-400 shrink-0" aria-label="Venta" />
                                )}
                                {new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(
                                  new Date(appt.appointment_datetime)
                                )}{' '}
                                {appt.contacts?.full_name || '—'}
                                {tier === 'xs' && (
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full shrink-0 ml-auto ${closerColorClass(appt.closer_id)}`}
                                    title={appt.closer?.full_name || 'Sin closer'}
                                  />
                                )}
                              </p>
                            ) : null}
                            {tier !== 'xs' ? (
                              <p className="text-[10px] text-brand-300 truncate flex items-center gap-1">
                                <span
                                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${closerColorClass(appt.closer_id)}`}
                                />
                                {appt.closer?.full_name || 'Sin closer'}
                              </p>
                            ) : null}
                            {tier === 'full' ? (
                              <>
                                {appt.setter?.full_name && (
                                  <p className="text-[10px] text-muted-foreground truncate">{appt.setter.full_name}</p>
                                )}
                                <div className="flex items-center gap-1 flex-wrap mt-1">
                                  <Badge
                                    className={`border text-[10px] gap-1 whitespace-nowrap ${CATEGORY_BADGE_CLASSES[category]}`}
                                  >
                                    {category === 'compra' && <Banknote className="w-3 h-3" />}
                                    {CATEGORY_LABELS[category]}
                                  </Badge>
                                  {appt.needs_followup ? (
                                    <Badge className="border text-[10px] bg-indigo-500/20 text-indigo-300 border-indigo-500/30 whitespace-nowrap">
                                      Seguimiento
                                    </Badge>
                                  ) : null}
                                  {appt.duration_minutes ? (
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                      {appt.duration_minutes} min
                                    </span>
                                  ) : null}
                                </div>
                              </>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'analisis' && (
        <AgendasAnalysisView
          aiKpis={aiKpis}
          pendingAnalysisAppointments={pendingAnalysisAppointments}
          analyzedAppointments={analyzedAppointments}
          onSelectAppointment={(appt) => {
            setSelectedAppointment(appt)
            setSheetOpen(true)
          }}
        />
      )}

      {view === 'metricas' && (
        <AgendasMetricsView
          metricsPeriodPreset={metricsPeriodPreset}
          onMetricsPeriodPresetChange={setMetricsPeriodPreset}
          metricsCustomFrom={metricsCustomFrom}
          metricsCustomTo={metricsCustomTo}
          onMetricsCustomFromChange={setMetricsCustomFrom}
          onMetricsCustomToChange={setMetricsCustomTo}
          setterMetrics={setterMetrics}
          prevSetterMetrics={prevSetterMetrics}
          closerMetrics={closerMetrics}
          prevCloserMetrics={prevCloserMetrics}
          hasPrevPeriod={hasPrevPeriod}
        />
      )}

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="bg-card border-border text-foreground w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            {selectedAppointment && (
              <div className="space-y-1">
                <SheetTitle className="text-left text-2xl font-semibold text-foreground text-pretty">
                  <a
                    href={`/${tenant}/crm/contactos/${selectedAppointment.contact_id}`}
                    className="hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm"
                  >
                    {selectedAppointment.contacts?.full_name || 'Contacto sin nombre'}
                  </a>
                </SheetTitle>
                {selectedAppointment.contacts?.email && (
                  <a
                    href={`/${tenant}/crm/contactos/${selectedAppointment.contact_id}`}
                    className="block w-fit text-sm text-brand-400 hover:text-brand-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm"
                  >
                    {selectedAppointment.contacts.email}
                  </a>
                )}
                <p className="text-xs text-muted-foreground">
                  Detalle de agenda · {formatDateTime(selectedAppointment.appointment_datetime)}
                </p>
              </div>
            )}
          </SheetHeader>
          {selectedAppointment && (
            <div className="mt-6">
              <AppointmentDetail
                // El Sheet NO se desmonta al cambiar de cita: solo cambia el prop. Sin esta key, todos
                // los useState(appointment.x) del panel se quedan con los valores de la cita ANTERIOR
                // —notas, URL de grabación, transcripción y el marcado del resultado— y al guardar se
                // escriben en la cita que está abierta ahora. La key fuerza el remontaje, que es lo que
                // reinicializa ese estado.
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
                  // Quita la fila del estado local para que los KPIs de la pantalla se recalculen ya.
                  setAppointments((prev) => prev.filter((a) => a.id !== id))
                  setSheetOpen(false)
                  setSelectedAppointment(null)
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* New Appointment Modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setShowNewModal(false)
            resetNewAppointmentForm()
          }}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nueva agenda</h3>
              <button
                onClick={() => {
                  setShowNewModal(false)
                  resetNewAppointmentForm()
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Contact selection */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Contacto</p>

              {naSelectedContact ? (
                <div className="bg-muted border border-border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{naSelectedContact.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {naSelectedContact.email || naSelectedContact.phone || 'Sin datos'}
                    </p>
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setNaSelectedContact(null)}
                  >
                    Cambiar
                  </button>
                </div>
              ) : null}

              {naSelectedContact && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Zona horaria del contacto (esta es la que verá el lead en la confirmación de Calendly, no la tuya)
                  </p>
                  <select
                    value={naContactTimezone}
                    onChange={(e) => setNaContactTimezone(e.target.value)}
                    className={cls}
                  >
                    {!TIMEZONE_OPTIONS.some((o) => o.value === naContactTimezone) && (
                      <option value={naContactTimezone}>{naContactTimezone}</option>
                    )}
                    {TIMEZONE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!naSelectedContact && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      placeholder="Buscar por nombre, email o teléfono..."
                      value={naContactSearch}
                      onChange={(e) => setNaContactSearch(e.target.value)}
                      className={`${cls} pl-9`}
                    />
                  </div>

                  {(naContactResults.length > 0 || naSearchLoading) && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      {naSearchLoading ? (
                        <div className="p-3 text-center text-muted-foreground text-sm">Buscando...</div>
                      ) : (
                        naContactResults.map((c) => (
                          <button
                            key={c.id}
                            className="w-full text-left px-4 py-3 hover:bg-muted transition-colors border-b border-border last:border-0"
                            onClick={() => {
                              setNaSelectedContact(c)
                              setNaContactSearch('')
                              setNaContactResults([])
                            }}
                          >
                            <p className="text-foreground text-sm font-medium">{c.full_name}</p>
                            <p className="text-muted-foreground text-xs">{c.email || c.phone || 'Sin datos'}</p>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {!naShowNewContactForm && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-dashed border-border text-brand-400 hover:text-brand-300"
                      onClick={() => {
                        setNaShowNewContactForm(true)
                        setNaNewContactName(naContactSearch)
                      }}
                    >
                      + Crear nuevo contacto
                    </Button>
                  )}

                  {naShowNewContactForm && (
                    <div className="border border-border rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground">Nuevo contacto</p>
                      <input
                        placeholder="Nombre completo *"
                        value={naNewContactName}
                        onChange={(e) => setNaNewContactName(e.target.value)}
                        className={cls}
                      />
                      <input
                        placeholder="Email"
                        type="email"
                        value={naNewContactEmail}
                        onChange={(e) => setNaNewContactEmail(e.target.value)}
                        className={cls}
                      />
                      <input
                        placeholder="Teléfono"
                        type="tel"
                        value={naNewContactPhone}
                        onChange={(e) => setNaNewContactPhone(e.target.value)}
                        className={cls}
                      />
                      <input
                        placeholder="Instagram (opcional)"
                        value={naNewContactInstagram}
                        onChange={(e) => setNaNewContactInstagram(e.target.value)}
                        className={cls}
                      />
                      <p className="text-xs text-muted-foreground">
                        * Nombre obligatorio, y al menos email o teléfono.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleCreateContactInline} disabled={!naNewContactName}>
                          Crear y seleccionar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setNaShowNewContactForm(false)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Setter / Closer */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Setter (opcional)</p>
                <select value={naSetterId} onChange={(e) => setNaSetterId(e.target.value)} className={cls}>
                  <option value="">— sin setter —</option>
                  {setters.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Closer</p>
                <select value={naCloserId} onChange={(e) => setNaCloserId(e.target.value)} className={cls}>
                  <option value="">— sin closer —</option>
                  {closers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Agenda: con closer → huecos reales de Calendly (o modo manual); sin closer → manual */}
            {naCloserId ? (
              <div className="space-y-3">
                {naHasCalendly === true && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={naManualMode}
                      onChange={(e) => {
                        setNaManualMode(e.target.checked)
                        setNaSelectedSlot('')
                      }}
                      className="accent-brand-500"
                    />
                    Elegir hora libre en la plataforma (sin crear evento en Calendly)
                  </label>
                )}

                {naManualMode ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">Fecha y hora</p>
                      <input
                        type="datetime-local"
                        value={naDatetime}
                        onChange={(e) => setNaDatetime(e.target.value)}
                        className={cls}
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">Duración (min)</p>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={naDurationMinutes}
                        onChange={(e) => setNaDurationMinutes(e.target.value)}
                        className={cls}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">Día</p>
                        <CalendarPopover
                          value={naSlotDate || null}
                          onChange={setNaSlotDate}
                          placeholder="Elige un día"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">Duración (min)</p>
                        <input
                          type="number"
                          min={5}
                          step={5}
                          value={naDurationMinutes}
                          onChange={(e) => setNaDurationMinutes(e.target.value)}
                          className={cls}
                        />
                      </div>
                    </div>

                    {!naSlotDate && (
                      <p className="text-xs text-muted-foreground">
                        Elige un día para ver los huecos disponibles en el Calendly del closer.
                      </p>
                    )}
                    {naSlotDate && naSlotsLoading && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" /> Cargando huecos de Calendly…
                      </div>
                    )}
                    {naSlotDate && !naSlotsLoading && naHasCalendly === false && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                        <p className="text-xs text-amber-400">
                          {naCalendlyMsg || 'Este closer no tiene Calendly.'} La cita se creará solo en la app.
                        </p>
                        <input
                          type="datetime-local"
                          value={naDatetime}
                          onChange={(e) => setNaDatetime(e.target.value)}
                          className={cls}
                        />
                      </div>
                    )}
                    {naSlotDate && !naSlotsLoading && naCalendlyMsg && naHasCalendly === null && (
                      <p className="text-xs text-red-400">{naCalendlyMsg}</p>
                    )}
                    {naSlotDate &&
                      !naSlotsLoading &&
                      naHasCalendly === true &&
                      (naSlots.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No hay huecos disponibles ese día. Prueba otra fecha.
                        </p>
                      ) : (
                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                          {naSlots.map((s) => {
                            const label = new Date(s.start_time).toLocaleTimeString('es-ES', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: userTimezone,
                            })
                            const active = naSelectedSlot === s.start_time
                            return (
                              <button
                                key={s.start_time}
                                type="button"
                                onClick={() => setNaSelectedSlot(s.start_time)}
                                className={`rounded-lg border p-2 text-sm transition ${active ? 'border-brand-500 bg-brand-600/20 text-foreground' : 'border-border bg-muted text-foreground hover:border-brand-500/50'}`}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      ))}
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Fecha y hora</p>
                  <input
                    type="datetime-local"
                    value={naDatetime}
                    onChange={(e) => setNaDatetime(e.target.value)}
                    className={cls}
                  />
                  <p className="text-xs text-muted-foreground">Sin closer: cita manual (no se envía a Calendly).</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Duración (min)</p>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={naDurationMinutes}
                    onChange={(e) => setNaDurationMinutes(e.target.value)}
                    className={cls}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowNewModal(false)
                  resetNewAppointmentForm()
                }}
                disabled={naSaving}
              >
                Cancelar
              </Button>
              <Button onClick={handleCreateAppointment} disabled={naSaving} className="bg-brand-600 hover:bg-brand-500">
                {naSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creando...
                  </>
                ) : (
                  'Crear agenda'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
