'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

type CalendarRole = 'primary' | 'conflict' | 'read_only'
type AvailableCalendar = {
  id: string
  name: string
  description: string | null
  timeZone: string | null
  primary: boolean
  accessRole: string
}
type SelectedCalendar = {
  external_calendar_id: string
  calendar_name: string
  role: CalendarRole
  time_zone: string | null
  is_enabled: boolean
}
type CalendarState = {
  connected: boolean
  accountEmail?: string | null
  status?: 'conectada' | 'revocada' | 'error'
  lastSyncAt?: string | null
  lastError?: string | null
  selected: SelectedCalendar[]
  available: AvailableCalendar[]
}
const ROLE_LABEL: Record<CalendarRole, string> = {
  primary: 'Principal',
  conflict: 'Conflictos',
  read_only: 'Solo lectura',
}

export function GoogleCalendarSettings({ tenant }: { tenant: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [state, setState] = useState<CalendarState | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('google')
    if (!result) return
    setOpen(true)
    if (result === 'conectada') toast.success('Google Calendar conectado')
    else if (result === 'cancelada') toast.info('Autorización cancelada')
    else toast.error('No se pudo completar la conexión de Google Calendar')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const load = useCallback(
    async (discover = false) => {
      setLoading(true)
      try {
        const response = await fetch(`/api/${tenant}/evergreen/google-calendar${discover ? '?discover=1' : ''}`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => ({}))) as CalendarState & {
          error?: string
          reconnect?: boolean
        }
        if (!response.ok) {
          toast.error(payload.error || 'No se pudo consultar Google Calendar')
          setState((current) => ({
            connected: payload.connected ?? false,
            selected: current?.selected ?? [],
            available: [],
            status: payload.reconnect ? 'revocada' : 'error',
            lastError: payload.error,
          }))
          return
        }
        setState(payload)
      } finally {
        setLoading(false)
      }
    },
    [tenant]
  )

  useEffect(() => {
    if (open) void load(true)
  }, [load, open])

  const selectedById = useMemo(
    () => new Map((state?.selected ?? []).map((calendar) => [calendar.external_calendar_id, calendar])),
    [state?.selected]
  )

  async function selectCalendar(calendarId: string, role: CalendarRole) {
    setSavingId(calendarId)
    try {
      const response = await fetch(`/api/${tenant}/evergreen/google-calendar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId, role }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el calendario')
      toast.success(`Calendario configurado como ${ROLE_LABEL[role].toLowerCase()}`)
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el calendario')
    } finally {
      setSavingId(null)
    }
  }

  async function removeCalendar(calendarId: string) {
    setSavingId(calendarId)
    try {
      const response = await fetch(
        `/api/${tenant}/evergreen/google-calendar?calendarId=${encodeURIComponent(calendarId)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error('No se pudo quitar el calendario')
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo quitar el calendario')
    } finally {
      setSavingId(null)
    }
  }

  async function disconnect() {
    setSavingId('disconnect')
    try {
      const response = await fetch(`/api/${tenant}/evergreen/google-calendar`, { method: 'DELETE' })
      if (!response.ok) throw new Error('No se pudo desconectar la cuenta')
      toast.success('Google Calendar desconectado')
      setState({ connected: false, selected: [], available: [] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo desconectar la cuenta')
    } finally {
      setSavingId(null)
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const response = await fetch(`/api/${tenant}/evergreen/google-calendar`, { method: 'POST' })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        eventsWritten?: number
        failures?: string[]
        reconciliation?: { matched: number; unresolved: number }
      }
      if (!response.ok && response.status !== 207) throw new Error(payload.error || 'No se pudo sincronizar')
      if (payload.failures?.length) {
        toast.warning(`Sincronización parcial: ${payload.failures.length} calendario(s) con error`)
      } else {
        const matched = payload.reconciliation?.matched ?? 0
        const unresolved = payload.reconciliation?.unresolved ?? 0
        toast.success(
          `${payload.eventsWritten ?? 0} evento(s) revisados · ${matched} enlazados · ${unresolved} pendientes`
        )
      }
      await load(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo sincronizar Google Calendar')
    } finally {
      setSyncing(false)
    }
  }

  const connectUrl = `/api/${tenant}/evergreen/oauth/google/start?provider=calendar`

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <CalendarDays className="mr-2 h-4 w-4" /> Mi Google Calendar
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto border-border bg-card text-foreground sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Mi Google Calendar</SheetTitle>
          <SheetDescription>
            Conecta tu cuenta y decide qué calendario contiene reuniones comerciales. Los calendarios de conflicto solo
            bloquearán disponibilidad; no crearán contactos ni afectarán métricas.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {loading && !state ? (
            <div className="space-y-3" aria-live="polite">
              <div className="h-5 w-52 animate-pulse rounded bg-muted" />
              <div className="h-20 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : !state?.connected ? (
            <div className="space-y-4 border-t border-border pt-5">
              <div>
                <p className="font-medium">Autoriza acceso de solo lectura</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Growth Operator podrá leer la lista de calendarios y sus eventos para conciliarlos. No podrá crear,
                  editar ni borrar eventos.
                </p>
              </div>
              {state?.lastError ? <p className="text-sm text-destructive">{state.lastError}</p> : null}
              <Button asChild>
                <a href={connectUrl}>
                  {state?.status === 'revocada' ? 'Reconectar con Google' : 'Conectar con Google'}
                </a>
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
                <div>
                  <p className="text-sm font-medium">{state.accountEmail || 'Cuenta de Google conectada'}</p>
                  <p className="text-xs text-muted-foreground">Solo lectura · conexión personal de esta subcuenta</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void syncNow()} disabled={syncing || state.selected.length === 0}>
                    {syncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sincronizar ahora
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading}>
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Actualizar lista
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="font-medium">Calendarios disponibles</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Elige uno como principal. Puedes añadir otros para detectar conflictos o revisarlos sin convertirlos
                  en reuniones comerciales.
                </p>
              </div>

              <div className="divide-y divide-border border-y border-border">
                {(state.available ?? []).map((calendar) => {
                  const selected = selectedById.get(calendar.id)
                  const busy = savingId === calendar.id
                  return (
                    <div key={calendar.id} className="py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {calendar.name}{' '}
                            {calendar.primary ? (
                              <span className="text-muted-foreground">· Google principal</span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {calendar.timeZone || 'Zona horaria no indicada'} · {calendar.accessRole}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(['primary', 'conflict', 'read_only'] as const).map((role) => (
                            <Button
                              key={role}
                              size="sm"
                              variant={selected?.role === role ? 'default' : 'outline'}
                              onClick={() => void selectCalendar(calendar.id, role)}
                              disabled={busy}
                            >
                              {selected?.role === role ? <Check className="mr-1.5 h-3.5 w-3.5" /> : null}
                              {ROLE_LABEL[role]}
                            </Button>
                          ))}
                          {selected ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void removeCalendar(calendar.id)}
                              disabled={busy}
                            >
                              Quitar
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {!loading && state.available.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Google no devolvió calendarios visibles para esta cuenta. Comprueba los permisos y vuelve a conectar.
                </p>
              ) : null}

              <div className="border-t border-border pt-5">
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void disconnect()}
                  disabled={savingId === 'disconnect'}
                >
                  <Unplug className="mr-2 h-4 w-4" /> Desconectar mi cuenta
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
