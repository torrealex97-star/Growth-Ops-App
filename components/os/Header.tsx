'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Menu, Bell, AlertTriangle, ChevronsUpDown, Check, X, CalendarClock, Loader2, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ROLE_LABELS, ROLE_COLORS, isLeadership, type AppRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/client'
import { getInitials, cn, formatDateTime } from '@/lib/utils'
import { FeedbackDialog } from '@/components/os/FeedbackDialog'
import { GlobalSearch } from '@/components/os/GlobalSearch'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import type { AppointmentStatus, User } from '@/lib/types/database'
import type { Alerta } from '@/lib/metrics/alertas'
import { esFalloVisible, pedir } from '@/lib/ui/pedir'
import { toast } from 'sonner'

interface HeaderProps {
  user: User & { roles: { key: string; name: string } }
  onMenuClick: () => void
  title?: string
  isSuperAdmin?: boolean
}

type MissingLinkAppt = { id: string; appointment_datetime: string; contacts: { full_name: string | null } | null }
type PendingAttendance = MissingLinkAppt
type TenantOption = { slug: string; name: string }
const UNRESOLVED_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'rescheduled']

export function Header({ user, onMenuClick, title, isSuperAdmin }: HeaderProps) {
  const role = user.roles.key as AppRole
  const tenant = useTenant()
  const tenantId = useTenantId()
  const router = useRouter()
  const [missing, setMissing] = useState<MissingLinkAppt[]>([])
  const [pendingAttendance, setPendingAttendance] = useState<PendingAttendance[]>([])
  const [updatingAttendance, setUpdatingAttendance] = useState<string | null>(null)
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [metricAlerts, setMetricAlerts] = useState<Alerta[]>([])
  const [metricAlertsLoaded, setMetricAlertsLoaded] = useState(false)
  const [metricAlertsLoading, setMetricAlertsLoading] = useState(false)
  const [metricAlertsError, setMetricAlertsError] = useState<string | null>(null)
  const [metricAlertsRetry, setMetricAlertsRetry] = useState(0)

  // Alerta de obligación: agendas ASISTIDAS (show) SIN enlace de llamada (recording_url). El closer
  // debe añadirlo. Liderazgo ve todas; el resto solo las suyas (además la RLS por scope las acota).
  useEffect(() => {
    let active = true
    ;(async () => {
      const sb = createClient()
      let q = sb
        .from('appointments')
        .select('id, appointment_datetime, contacts(full_name)')
        .eq('tenant_id', tenantId)
        .eq('status', 'show')
        .is('recording_url', null)
        .order('appointment_datetime', { ascending: false })
        .limit(30)
      if (!isLeadership(role)) q = q.eq('closer_id', user.id)
      const { data } = await q
      if (active) setMissing((data as unknown as MissingLinkAppt[]) ?? [])
    })()
    return () => {
      active = false
    }
  }, [role, user.id, tenantId])

  useEffect(() => {
    let active = true
    ;(async () => {
      const sb = createClient()
      let q = sb
        .from('appointments')
        .select('id, appointment_datetime, contacts(full_name)')
        .eq('tenant_id', tenantId)
        .in('status', UNRESOLVED_STATUSES)
        .lt('appointment_datetime', new Date().toISOString())
        .order('appointment_datetime', { ascending: false })
        .limit(20)
      if (!isLeadership(role)) q = q.or(`setter_id.eq.${user.id},closer_id.eq.${user.id}`)
      const { data } = await q
      if (active) setPendingAttendance((data as unknown as PendingAttendance[]) ?? [])
    })()
    return () => {
      active = false
    }
  }, [role, tenantId, user.id])

  const markAttendance = async (id: string, status: AppointmentStatus) => {
    setUpdatingAttendance(id)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: id, status }),
      })
      if (!res.ok) throw new Error('No se pudo actualizar la asistencia')
      setPendingAttendance((current) => current.filter((item) => item.id !== id))
      toast.success(status === 'show' ? 'Asistencia confirmada' : 'Ausencia registrada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la asistencia')
    } finally {
      setUpdatingAttendance(null)
    }
  }

  // Tenant switcher: solo para super_admin. RLS en `tenants` devuelve todas
  // las subcuentas cuando is_super_admin() es true. Las ARCHIVADAS no se
  // listan: navegar a su URL acabaría en 404 (el layout las bloquea) y en el
  // selector solo confundirían; se administran desde Configuración › Subcuentas.
  useEffect(() => {
    if (!isSuperAdmin) return
    let active = true
    ;(async () => {
      const sb = createClient()
      const { data } = await sb.from('tenants').select('slug, name').neq('status', 'archived').order('name')
      if (active) setTenants((data as TenantOption[]) ?? [])
    })()
    return () => {
      active = false
    }
  }, [isSuperAdmin])

  // El brief necesita varias lecturas paginadas. Cargarlo en cada pantalla solo para rellenar la
  // campana multiplicaría consultas y CPU; se trae una vez, al abrir Notificaciones, con timeout y
  // cancelación. Así las alertas existen donde se esperan sin convertir el Header en polling global.
  useEffect(() => {
    if (!notificationsOpen || metricAlertsLoaded) return
    const ac = new AbortController()
    let active = true
    setMetricAlertsLoading(true)
    setMetricAlertsError(null)
    ;(async () => {
      const res = await pedir<{ brief: { alertas: Alerta[] } }>(`/api/${tenant}/evergreen/metricas/brief`, {
        signal: ac.signal,
      })
      if (!active) return
      if (res.ok) {
        setMetricAlerts(res.data.brief.alertas)
        setMetricAlertsLoaded(true)
      } else if (esFalloVisible(res)) {
        setMetricAlertsError(res.mensaje)
      }
      setMetricAlertsLoading(false)
    })()
    return () => {
      active = false
      ac.abort()
    }
  }, [metricAlertsLoaded, metricAlertsRetry, notificationsOpen, tenant])

  useEffect(() => {
    setMetricAlerts([])
    setMetricAlertsLoaded(false)
    setMetricAlertsLoading(false)
    setMetricAlertsError(null)
  }, [tenant])

  const count = missing.length + pendingAttendance.length + metricAlerts.length

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border bg-background/95 backdrop-blur-xl px-4 lg:px-7">
      <Button variant="ghost" size="icon" className="lg:hidden mr-2 text-muted-foreground" onClick={onMenuClick}>
        <Menu className="w-5 h-5" />
      </Button>

      <div className="flex-1 min-w-0 flex items-center gap-3">
        {title && <h1 className="text-sm font-medium text-muted-foreground truncate">{title}</h1>}
        {isSuperAdmin && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground min-w-0 max-w-full"
              >
                <span className="text-xs shrink-0 hidden sm:inline">Subcuenta:</span>
                <span className="text-sm font-medium text-foreground truncate">{tenant}</span>
                <ChevronsUpDown className="w-3.5 h-3.5 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 bg-card border-border p-1">
              {tenants.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => router.push(`/${t.slug}/dashboard`)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm hover:bg-muted/60 transition-colors text-left"
                >
                  <span className="text-foreground">{t.name}</span>
                  {t.slug === tenant && <Check className="w-3.5 h-3.5 text-brand-400" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        <GlobalSearch user={user} />
        <FeedbackDialog />
        <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground"
              aria-label={count > 0 ? `Notificaciones: ${count} pendientes` : 'Notificaciones'}
            >
              <Bell className="w-4 h-4" />
              {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-foreground text-[10px] font-bold flex items-center justify-center">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 bg-card border-border p-0">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Notificaciones</p>
            </div>
            {count === 0 && metricAlertsLoaded ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">Todo al día. Sin pendientes.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-border">
                {metricAlertsLoading && (
                  <div className="flex items-center justify-center gap-2 px-4 py-5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Revisando métricas…
                  </div>
                )}
                {metricAlertsError && (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    <p>{metricAlertsError}</p>
                    <button
                      type="button"
                      className="mt-2 font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setMetricAlertsRetry((actual) => actual + 1)}
                    >
                      Reintentar
                    </button>
                  </div>
                )}
                {metricAlerts.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-4 py-2 text-xs text-amber-400">
                      <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                      {metricAlerts.length} alerta{metricAlerts.length === 1 ? '' : 's'} del Growth Brief
                    </div>
                    {metricAlerts.map((alerta) => (
                      <Link
                        key={alerta.id}
                        href={`/${tenant}/unit-economics`}
                        className="block border-t border-border px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <p className="text-sm font-medium text-foreground">{alerta.titulo}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{alerta.detalle}</p>
                      </Link>
                    ))}
                  </div>
                )}
                {pendingAttendance.length > 0 && (
                  <div>
                    <div className="px-4 py-2 flex items-center gap-2 text-amber-400 text-xs">
                      <CalendarClock className="w-3.5 h-3.5" />
                      {pendingAttendance.length} reunión{pendingAttendance.length === 1 ? '' : 'es'} pendiente
                      {pendingAttendance.length === 1 ? '' : 's'} de asistencia
                    </div>
                    {pendingAttendance.map((appointment) => (
                      <div key={appointment.id} className="border-t border-border px-4 py-2.5">
                        <p className="truncate text-sm text-foreground">
                          {appointment.contacts?.full_name || 'Contacto'}
                        </p>
                        <p className="mb-2 text-xs text-muted-foreground">
                          {formatDateTime(appointment.appointment_datetime)}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-emerald-400"
                            disabled={updatingAttendance === appointment.id}
                            onClick={() => void markAttendance(appointment.id, 'show')}
                          >
                            <Check className="mr-1 h-3 w-3" /> Asistió
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-400"
                            disabled={updatingAttendance === appointment.id}
                            onClick={() => void markAttendance(appointment.id, 'no_show')}
                          >
                            <X className="mr-1 h-3 w-3" /> No asistió
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {missing.length > 0 && (
                  <div>
                    <div className="px-4 py-2 flex items-center gap-2 text-amber-400 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {missing.length} reunión{missing.length === 1 ? '' : 'es'} asistida
                      {missing.length === 1 ? '' : 's'} sin enlace de llamada
                    </div>
                    {missing.map((a) => (
                      <Link
                        key={a.id}
                        href={`/${tenant}/crm/agendas`}
                        className="block px-4 py-2.5 hover:bg-muted/60 transition-colors"
                      >
                        <p className="text-sm text-foreground truncate">{a.contacts?.full_name || 'Contacto'}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(a.appointment_datetime)} · Falta enlace de la llamada
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Link
          href={`/${tenant}/perfil`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title="Mi perfil y contraseña"
        >
          <Avatar className="w-7 h-7">
            <AvatarFallback className="text-xs">{getInitials(user.full_name)}</AvatarFallback>
          </Avatar>
          <div className="hidden sm:block">
            <span className="text-sm text-foreground font-medium">{user.full_name}</span>
            <Badge className={cn('ml-2 text-xs px-1.5 py-0 border', ROLE_COLORS[role])}>{ROLE_LABELS[role]}</Badge>
          </div>
        </Link>
      </div>
    </header>
  )
}
