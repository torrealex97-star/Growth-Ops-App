'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { CalendarPopover } from '@/components/ui/calendar-popover'
import { Loader2, Trash2, Phone } from 'lucide-react'
import { formatDateTime, formatDate } from '@/lib/utils'
import { fireConfetti, cheerMessage } from '@/lib/confetti'
import { toast } from 'sonner'
import { MarcadoRapido } from '@/components/appointments/MarcadoRapido'
import type { AppointmentWithRelations, AppointmentStatus } from '@/lib/types/database'
import { STATUS_COLORS, STATUS_LABELS, isNoShow } from '@/lib/appointments/status'
import { getQualificationEntries, type Qualification } from '@/lib/appointments/qualification'
import { extraerRespuestas } from '@/lib/metrics/respuestas-formulario'
import { evaluarCualificacion } from '@/lib/metrics/cualificacion'
import { guessContactTimezone, TIMEZONE_OPTIONS } from '@/lib/timezone'
import { useTenant } from '@/lib/tenant-context'

// Campos IA (aún no están en el tipo Appointment global — se acceden vía cast local)
type AiAnalysis = {
  objections?: string[]
  next_steps?: string[]
  tasks?: string[]
}

type AppointmentWithAi = AppointmentWithRelations & {
  transcript?: string | null
  transcript_drive_url?: string | null
  transcript_status?: string | null
  ai_call_score?: number | null
  ai_lead_score?: number | null
  ai_suggested_stage?: string | null
  ai_summary?: string | null
  ai_analysis?: AiAnalysis | null
  ai_analyzed_at?: string | null
}

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus:border-brand-500'

const CANCELLED_STATUSES: AppointmentStatus[] = ['cancelled', 'cancelled_admin', 'cancelled_lead']

type ActivityRow = {
  id: string
  type: string
  direction: string | null
  result: string | null
  duration_min: number | null
  notes: string | null
  created_at: string
  author: string
}

const ACTIVITY_RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: 'contactado', label: 'Contactado' },
  { value: 'no_contesta', label: 'No contesta' },
  { value: 'buzon', label: 'Buzón de voz' },
  { value: 'conversacion', label: 'Conversación' },
  { value: 'cita_agendada', label: 'Cita agendada' },
]
const ACTIVITY_RESULT_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVITY_RESULT_OPTIONS.map((o) => [o.value, o.label])
)

interface AppointmentDetailProps {
  appointment: AppointmentWithRelations
  canChangeStatus: boolean
  currentUserName?: string
  /** Solo admin: permite borrar la agenda si está duplicada (deja de contar en KPIs). */
  canDelete?: boolean
  /** Solo liderazgo (admin/director/manager): permite reasignar el closer desde el detalle. */
  canReassignCloser?: boolean
  /** Solo liderazgo (admin/director/manager): permite reasignar el setter desde el detalle. */
  canReassignSetter?: boolean
  /** Closers disponibles para el selector de reasignación. */
  closers?: { id: string; full_name: string }[]
  /** Setters disponibles para el selector de reasignación. */
  setters?: { id: string; full_name: string }[]
  /**
   * Muestra el payload crudo del webhook (GHL/Calendly). Solo para quien administra la subcuenta:
   * es un volcado interno con campos técnicos, ids externos y datos del lead sin normalizar, y un
   * setter o closer no tiene nada que hacer ahí — las respuestas del formulario ya se pintan
   * legibles justo arriba, en "Formulario / Cualificación".
   *
   * Nota honesta: el brief pedía "solo super_admin", pero el vocabulario de roles del cliente
   * (`currentUserRole`) no incluye super_admin — solo llega hasta 'admin'. Así que 'admin' es el
   * cierre más estricto que se puede aplicar aquí sin una consulta extra por cada ficha abierta.
   */
  canSeeRawPayload?: boolean
  onStatusChange?: (id: string, status: AppointmentStatus) => void
  onCancelled?: (id: string) => void
  onDeleted?: (id: string) => void
  onRescheduled?: (id: string, patch: { appointment_datetime: string; duration_minutes: number }) => void
  onFollowUpChange?: (id: string, needsFollowup: boolean) => void
  onCloserChanged?: (id: string, closer: { id: string; full_name: string } | null) => void
  onSetterChanged?: (id: string, setter: { id: string; full_name: string } | null) => void
}

export function AppointmentDetail({
  appointment: appointmentProp,
  canChangeStatus,
  currentUserName,
  canDelete,
  canReassignCloser,
  canReassignSetter,
  closers,
  setters,
  canSeeRawPayload = false,
  onStatusChange,
  onCancelled,
  onDeleted,
  onRescheduled,
  onFollowUpChange,
  onCloserChanged,
  onSetterChanged,
}: AppointmentDetailProps) {
  const tenant = useTenant()
  const appointment = appointmentProp as AppointmentWithAi
  const [updating, setUpdating] = useState(false)
  const [updatingFollowUp, setUpdatingFollowUp] = useState(false)
  const [notes, setNotes] = useState(appointment.notes ?? '')
  const [recordingUrl, setRecordingUrl] = useState(appointment.recording_url ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [userTimezone, setUserTimezone] = useState<string>('Europe/Madrid')
  const [editingCloser, setEditingCloser] = useState(false)
  const [closerSaving, setCloserSaving] = useState(false)
  const [editingSetter, setEditingSetter] = useState(false)
  const [setterSaving, setSetterSaving] = useState(false)
  // Timezone del CONTACTO (no de quien reprograma): es la que se manda a Calendly como zona del
  // invitado, para que el lead vea/reciba la nueva hora en su horario real.
  const [rsContactTimezone, setRsContactTimezone] = useState<string>(() => guessContactTimezone(appointment.contacts))

  // Detecta la timezone del navegador al montar el componente (solo para mostrar los huecos de
  // Calendly en la hora del closer al elegir uno, no se usa para lo que ve el contacto)
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    setUserTimezone(tz || 'Europe/Madrid')
  }, [])

  // Reprogramar: selector de día + huecos de Calendly del closer (o hueco manual si no tiene).
  const [showReschedule, setShowReschedule] = useState(false)
  const [rsDate, setRsDate] = useState<string | null>(null)
  const [rsSlots, setRsSlots] = useState<{ start_time: string }[]>([])
  const [rsSelectedSlot, setRsSelectedSlot] = useState('')
  const [rsSlotsLoading, setRsSlotsLoading] = useState(false)
  const [rsHasCalendly, setRsHasCalendly] = useState<boolean | null>(null)
  const [rsMsg, setRsMsg] = useState('')
  const [rsManualDatetime, setRsManualDatetime] = useState('')
  const [rsManualMode, setRsManualMode] = useState(false) // reprogramar solo en la plataforma (sin Calendly)
  const [rescheduling, setRescheduling] = useState(false)

  // Grabación y transcripción
  const [driveUrl, setDriveUrl] = useState(appointment.transcript_drive_url ?? '')
  const [transcriptText, setTranscriptText] = useState(appointment.transcript ?? '')
  const [analyzing, setAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState<{
    call_score: number | null
    lead_score: number | null
    suggested_stage: string | null
    summary: string | null
    objections: string[]
    next_steps: string[]
    tasksCreated: number
  } | null>(
    appointment.ai_analyzed_at
      ? {
          call_score: appointment.ai_call_score ?? null,
          lead_score: appointment.ai_lead_score ?? null,
          suggested_stage: appointment.ai_suggested_stage ?? null,
          summary: appointment.ai_summary ?? null,
          objections: appointment.ai_analysis?.objections ?? [],
          next_steps: appointment.ai_analysis?.next_steps ?? [],
          tasksCreated: 0,
        }
      : null
  )

  const dirty = notes !== (appointment.notes ?? '') || recordingUrl !== (appointment.recording_url ?? '')

  // Historial de llamadas (tabla `activities`, por contacto): permite ver todos los intentos de
  // contacto previos (de cualquier agenda de ese contacto) y registrar uno nuevo sin salir de aquí.
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [newActivityResult, setNewActivityResult] = useState('contactado')
  const [postingActivity, setPostingActivity] = useState(false)

  useEffect(() => {
    if (!appointment.contact_id) return
    let cancelled = false
    setLoadingActivities(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/contacts/${appointment.contact_id}/activities`)
        const json = await res.json()
        if (!cancelled && res.ok) setActivities(json.activities || [])
      } catch {
        // Historial secundario: si falla, no bloquea el resto del panel.
      } finally {
        if (!cancelled) setLoadingActivities(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appointment.contact_id])

  const submitActivity = async () => {
    if (!appointment.contact_id) return
    setPostingActivity(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/contacts/${appointment.contact_id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'llamada',
          result: newActivityResult,
          notes: notes.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo registrar la llamada')
      setActivities((prev) => [{ ...data.activity, author: currentUserName || 'Tú' }, ...prev])
      toast.success('Llamada registrada')
    } catch (err) {
      toast.error('No se pudo registrar la llamada', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setPostingActivity(false)
    }
  }

  // Carga los huecos reales del Calendly del closer para el día elegido en el reprogramador.
  useEffect(() => {
    if (!showReschedule || !appointment.closer_id || !rsDate) {
      setRsSlots([])
      return
    }
    let cancelled = false
    setRsSlotsLoading(true)
    setRsSelectedSlot('')
    setRsMsg('')
    ;(async () => {
      try {
        const res = await fetch(
          `/api/${tenant}/evergreen/calendly/availability?closerId=${appointment.closer_id}&date=${rsDate}`
        )
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setRsHasCalendly(null)
          setRsMsg(json.error || 'No se pudieron cargar los huecos')
          setRsSlots([])
        } else if (json.hasCalendly === false) {
          setRsHasCalendly(false)
          setRsMsg(json.reason || 'Este closer no tiene Calendly')
          setRsSlots([])
        } else {
          setRsHasCalendly(true)
          setRsSlots(json.slots || [])
        }
      } catch {
        if (!cancelled) {
          setRsMsg('Error de red al cargar huecos')
          setRsSlots([])
        }
      } finally {
        if (!cancelled) setRsSlotsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showReschedule, rsDate, appointment.closer_id])

  const resetRescheduleForm = () => {
    setRsDate(null)
    setRsSlots([])
    setRsSelectedSlot('')
    setRsSlotsLoading(false)
    setRsHasCalendly(null)
    setRsMsg('')
    setRsManualDatetime('')
    setRsManualMode(false)
    setRsContactTimezone(guessContactTimezone(appointment.contacts))
  }

  // Modo manual (solo plataforma) si: no hay closer, el closer no tiene Calendly, o el usuario
  // lo activa a mano (p.ej. reprogramar una agenda ya pasada, que Calendly no permite).
  // Con Calendly exigimos un hueco real de la grilla; en manual, la fecha/hora escrita.
  const usesManualDatetime = rsManualMode || !appointment.closer_id || rsHasCalendly === false
  const startTimeToSend = usesManualDatetime
    ? rsManualDatetime
      ? new Date(rsManualDatetime).toISOString()
      : ''
    : rsSelectedSlot
  const canSubmitReschedule = !rescheduling && Boolean(startTimeToSend)

  const submitReschedule = async () => {
    if (!startTimeToSend) {
      toast.error(usesManualDatetime ? 'Indica la nueva fecha y hora' : 'Elige un hueco disponible en el calendario')
      return
    }
    setRescheduling(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          startTime: startTimeToSend,
          durationMinutes: appointment.duration_minutes || undefined,
          timezone: rsContactTimezone,
          manualOnly: usesManualDatetime,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo reprogramar')
      if (data?.calendlyCanceled === false) {
        toast.warning('Agenda reprogramada, pero el evento antiguo sigue en Calendly/Google Calendar', {
          description:
            'No se pudo cancelar el evento anterior automáticamente. Bórralo a mano para evitar un duplicado.',
        })
      } else {
        toast.success('Agenda reprogramada')
      }
      onRescheduled?.(appointment.id, {
        appointment_datetime: startTimeToSend,
        duration_minutes: appointment.duration_minutes || 30,
      })
      onStatusChange?.(appointment.id, 'scheduled')
      setShowReschedule(false)
      resetRescheduleForm()
    } catch (err) {
      toast.error('No se pudo reprogramar', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setRescheduling(false)
    }
  }

  const saveNote = async () => {
    setSavingNote(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          patch: { notes: notes.trim(), recording_url: recordingUrl.trim() },
        }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo guardar')
      fireConfetti()
      toast.success('¡Guardado! 🎉', {
        description: cheerMessage(currentUserName),
        action: data?.updatedAt
          ? {
              label: 'Deshacer',
              onClick: async () => {
                const undoRes = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    appointmentId: appointment.id,
                    expectedUpdatedAt: data.updatedAt,
                    patch: {
                      notes: appointment.notes ?? '',
                      recording_url: appointment.recording_url ?? '',
                    },
                  }),
                })
                const undoData = await undoRes.json().catch(() => ({}))
                if (!undoRes.ok) {
                  toast.error('No se pudo deshacer', { description: undoData?.error })
                  return
                }
                setNotes(appointment.notes ?? '')
                setRecordingUrl(appointment.recording_url ?? '')
                toast.success('Cambio deshecho')
              },
            }
          : undefined,
      })
    } catch (err) {
      toast.error('No se pudo guardar', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSavingNote(false)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true)
    // Vía endpoint server-side: la RLS de appointments solo deja UPDATE a admin/director; el endpoint
    // (service role) permite además que el setter/closer gestione SUS propias agendas.
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appointment.id, status: newStatus }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo actualizar')
      // Celebra los resultados positivos (se presentó / completada) con confeti + ánimo.
      if (newStatus === 'show' || newStatus === 'completed') {
        fireConfetti()
        toast.success('¡Estado actualizado! 🎉', { description: cheerMessage(currentUserName) })
      } else {
        toast.success('Estado actualizado')
      }
      onStatusChange?.(appointment.id, newStatus as AppointmentStatus)
    } catch (err) {
      toast.error('Error al actualizar el estado', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setUpdating(false)
    }
  }

  const handleCloserChange = async (value: string) => {
    const newCloserId = value === '__none__' ? null : value
    if (newCloserId === (appointment.closer_id ?? null)) {
      setEditingCloser(false)
      return
    }
    setCloserSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/reassign-closer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appointment.id, closerId: newCloserId }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo reasignar el closer')
      const newCloser = newCloserId ? (closers?.find((c) => c.id === newCloserId) ?? null) : null
      toast.success('Closer reasignado')
      onCloserChanged?.(appointment.id, newCloser)
    } catch (err) {
      toast.error('No se pudo reasignar el closer', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setCloserSaving(false)
      setEditingCloser(false)
    }
  }

  const handleSetterChange = async (value: string) => {
    const newSetterId = value === '__none__' ? null : value
    if (newSetterId === (appointment.setter_id ?? null)) {
      setEditingSetter(false)
      return
    }
    setSetterSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/reassign-setter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appointment.id, setterId: newSetterId }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo reasignar el setter')
      const newSetter = newSetterId ? (setters?.find((s) => s.id === newSetterId) ?? null) : null
      toast.success('Setter reasignado')
      onSetterChanged?.(appointment.id, newSetter)
    } catch (err) {
      toast.error('No se pudo reasignar el setter', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSetterSaving(false)
      setEditingSetter(false)
    }
  }

  const handleFollowUpToggle = async () => {
    const next = !appointment.needs_followup
    setUpdatingFollowUp(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appointment.id, needsFollowup: next }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo actualizar')
      toast.success(next ? 'Marcada en seguimiento' : 'Seguimiento quitado')
      onFollowUpChange?.(appointment.id, next)
    } catch (err) {
      toast.error('Error al actualizar seguimiento', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setUpdatingFollowUp(false)
    }
  }

  const analyzeCall = async () => {
    const sourceUrl = driveUrl.trim() || recordingUrl.trim()
    if (!sourceUrl && !transcriptText.trim()) {
      toast.error('Añade un enlace de grabación o una transcripción para analizar')
      return
    }
    setAnalyzing(true)
    try {
      if (recordingUrl.trim() && recordingUrl.trim() !== (appointment.recording_url ?? '')) {
        const saveRecording = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointmentId: appointment.id, patch: { recording_url: recordingUrl.trim() } }),
        })
        const recordingData = await saveRecording.json()
        if (!saveRecording.ok || recordingData?.error) {
          throw new Error(recordingData?.error || 'No se pudo guardar el enlace de grabación')
        }
      }
      // Con enlace de Drive (y sin transcripción pegada) → se procesa en segundo plano
      // (el worker soporta cualquier duración). La app solo lo encola.
      if (sourceUrl && !transcriptText.trim()) {
        const res = await fetch(`/api/${tenant}/evergreen/ai/queue-call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentId: appointment.id,
            driveUrl: sourceUrl,
            recordingUrl: recordingUrl.trim() || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data?.error || 'No se pudo encolar')
        toast.success('Grabación en cola de transcripción', {
          description: 'Se está procesando en segundo plano. Aparecerá en «Análisis IA» en unos minutos.',
        })
        setAnalyzing(false)
        return
      }
      // Transcripción pegada → análisis inmediato
      const res = await fetch(`/api/${tenant}/evergreen/ai/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          transcript: transcriptText.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'No se pudo analizar la llamada')
      }
      if (data.transcript) setTranscriptText(data.transcript)
      setAiResult({
        call_score: data.analysis?.call_score ?? null,
        lead_score: data.analysis?.lead_score ?? null,
        suggested_stage: data.analysis?.suggested_stage ?? null,
        summary: data.analysis?.summary ?? null,
        objections: data.analysis?.objections ?? [],
        next_steps: data.analysis?.next_steps ?? [],
        tasksCreated: data.tasksCreated ?? 0,
      })
      toast.success('Llamada analizada correctamente')
    } catch (err) {
      toast.error('Error al analizar la llamada', {
        description: err instanceof Error ? err.message : 'Inténtalo de nuevo',
      })
    } finally {
      setAnalyzing(false)
    }
  }

  const saveTranscriptFields = async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          patch: { transcript_drive_url: driveUrl.trim(), transcript: transcriptText.trim() },
        }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo guardar')
      toast.success('Guardado')
    } catch (err) {
      toast.error('No se pudo guardar', { description: err instanceof Error ? err.message : undefined })
    }
  }

  const handleCancelAppointment = async () => {
    if (!window.confirm('¿Seguro que quieres cancelar esta agenda?')) return
    const reason = window.prompt('Motivo de la cancelación (opcional):') ?? ''
    setCancelling(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appointment.id, reason: reason.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo cancelar la agenda')
      toast.success('Agenda cancelada')
      onStatusChange?.(appointment.id, 'cancelled_admin')
      onCancelled?.(appointment.id)
    } catch (err) {
      toast.error('Error al cancelar la agenda', {
        description: err instanceof Error ? err.message : 'Inténtalo de nuevo',
      })
    } finally {
      setCancelling(false)
    }
  }

  // Borrado de duplicados (solo admin). Doble confirmación: es la acción que altera KPIs.
  const handleDeleteAppointment = async () => {
    const who = appointment.contacts?.full_name || 'este contacto'
    if (
      !window.confirm(
        `Vas a BORRAR la agenda de ${who} (${formatDateTime(appointment.appointment_datetime)}).\n\n` +
          'Úsalo solo si está duplicada: dejará de contar en los KPIs. Se guarda una copia por si hay que recuperarla.\n\n¿Continuar?'
      )
    )
      return
    const reason = window.prompt('Motivo (opcional, queda en el registro):') ?? ''
    setDeleting(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appointment.id, reason: reason.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo borrar la agenda')
      toast.success('Agenda borrada. Ya no cuenta en los KPIs.')
      onDeleted?.(appointment.id)
    } catch (err) {
      toast.error('No se pudo borrar la agenda', {
        description: err instanceof Error ? err.message : 'Inténtalo de nuevo',
      })
    } finally {
      setDeleting(false)
    }
  }

  const qualification = appointment.qualification as Qualification | null
  // LA COLUMNA `qualification` ESTÁ VACÍA EN LA PRÁCTICA: 0 de 559 citas en producción. Las respuestas
  // del formulario viven en `raw_payload` (473 de 559), que es lo que manda el proveedor. Por eso esta
  // sección no aparecía nunca: leía la columna estructurada que nadie rellena, y la persona tenía que
  // desplegar el JSON crudo para ver lo que el lead había contestado.
  //
  // Se mira primero la columna, por si algún día se rellena, y si no se leen las respuestas del payload.
  const respuestasDelPayload = extraerRespuestas(appointment.raw_payload, appointment.external_source)
  const qualificationEntries = getQualificationEntries(qualification)
  const entradasFormulario =
    qualificationEntries.length > 0
      ? qualificationEntries
      : respuestasDelPayload.map((r) => ({ label: r.pregunta, value: r.respuesta }))

  // El veredicto de cualificación de MARKETING, con sus motivos. Es el que entra en el CPQBC, así que
  // enseñarlo aquí permite que quien llama vea lo mismo que cuenta el panel —y lo discuta si se equivoca.
  const veredicto = respuestasDelPayload.length > 0 ? evaluarCualificacion(respuestasDelPayload) : null

  const isCancelled = CANCELLED_STATUSES.includes(appointment.status)

  const fields = [
    { label: 'Telefono', value: appointment.contacts?.phone },
    { label: 'Instagram', value: appointment.contacts?.instagram },
    { label: 'Fecha y hora', value: formatDateTime(appointment.appointment_datetime) },
    { label: 'Fuente', value: appointment.source ?? '—' },
    { label: 'Pipeline', value: appointment.pipeline_name ?? '—' },
    { label: 'Etapa Pipeline', value: appointment.pipeline_stage ?? '—' },
    { label: 'Calendario', value: appointment.calendar_name ?? '—' },
    { label: 'UTM Source', value: appointment.utm_source ?? '—' },
    { label: 'UTM Medium', value: appointment.utm_medium ?? '—' },
    { label: 'UTM Campaign', value: appointment.utm_campaign ?? '—' },
    { label: 'UTM Content', value: appointment.utm_content ?? '—' },
    { label: 'UTM Term', value: appointment.utm_term ?? '—' },
    { label: 'Creado', value: formatDate(appointment.created_at) },
  ]

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center gap-3">
        <Badge className={`border text-sm px-3 py-1 ${STATUS_COLORS[appointment.status]}`}>
          {STATUS_LABELS[appointment.status]}
        </Badge>
        {isNoShow(appointment.rescheduled_from_status) && (
          <Badge className="border text-sm px-3 py-1 bg-red-500/10 text-red-400 border-red-500/30">
            Reagenda / No show
          </Badge>
        )}
        {appointment.rescheduled_from_status === 'show' && (
          <Badge className="border text-sm px-3 py-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            Reagenda / Show
          </Badge>
        )}

        {canChangeStatus && (
          <Select defaultValue={appointment.status} onValueChange={handleStatusChange} disabled={updating}>
            <SelectTrigger className="w-48 h-8 bg-muted border-border text-xs">
              <SelectValue placeholder="Cambiar estado" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-foreground">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {canChangeStatus && (
          <Button
            size="sm"
            variant="outline"
            className={
              appointment.needs_followup
                ? 'h-8 text-xs bg-indigo-500/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/30'
                : 'h-8 text-xs'
            }
            disabled={updatingFollowUp}
            onClick={handleFollowUpToggle}
          >
            {updatingFollowUp ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {appointment.needs_followup ? 'En seguimiento ✓' : 'Marcar en seguimiento'}
          </Button>
        )}
      </div>

      {/* MARCADO DEL RESULTADO. Va arriba, antes de las acciones y de los datos del contacto, porque es
          lo que hay que rellenar al colgar: si estuviera al final del panel, no se rellenaría. De aquí
          salen Show Rate, Pitch Rate, Close Rate y BAMFAM; por eso lo ven los mismos que pueden
          cambiar el estado de la cita — es la misma autoridad sobre el mismo dato. */}
      {canChangeStatus && (
        <MarcadoRapido
          tenant={tenant}
          cita={appointment}
          onMarcado={(id, cambios) => {
            // El padre mantiene la fila de la tabla; se le avisa con lo que de verdad ha cambiado en
            // vez de obligarle a recargar la lista entera.
            if (cambios.status) onStatusChange?.(id, cambios.status as AppointmentStatus)
            if (typeof cambios.needs_followup === 'boolean') onFollowUpChange?.(id, cambios.needs_followup)
          }}
        />
      )}

      {/* Acciones: unirse / reprogramar / cancelar */}
      <div className="flex flex-wrap gap-2">
        {appointment.meeting_url ? (
          <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-500">
            <a href={appointment.meeting_url} target="_blank" rel="noopener noreferrer">
              Unirse a la reunión
            </a>
          </Button>
        ) : null}
        {!isCancelled && (
          <Button
            size="sm"
            variant="outline"
            className="border-brand-700 text-brand-300 hover:bg-brand-500/10 hover:text-brand-200"
            onClick={() => setShowReschedule((v) => !v)}
          >
            Reprogramar
          </Button>
        )}
        {appointment.reschedule_url && (
          <Button asChild size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground">
            <a href={appointment.reschedule_url} target="_blank" rel="noopener noreferrer">
              Reprogramar en Calendly ↗
            </a>
          </Button>
        )}
        {!isCancelled && (
          <Button
            size="sm"
            variant="outline"
            className="border-red-900 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={handleCancelAppointment}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelando…' : 'Cancelar agenda'}
          </Button>
        )}
        {/* Solo admin: borrar duplicados para que no cuenten en los KPIs. */}
        {canDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 hover:bg-red-500/10 hover:text-red-400 ml-auto"
            onClick={handleDeleteAppointment}
            disabled={deleting}
            title="Borrar la agenda de la plataforma (solo si está duplicada)"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            {deleting ? 'Borrando…' : 'Borrar duplicada'}
          </Button>
        )}
      </div>

      {/* Aviso discreto: sin meeting_url pero enlazada a Calendly */}
      {!appointment.meeting_url && appointment.external_source === 'calendly' && !isCancelled && (
        <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Falta conectar Calendly/ubicación Meet del closer. En cuanto Calendly confirme la reunión, el enlace aparecerá
          aquí automáticamente.
        </p>
      )}

      {/* Panel de reprogramación: día + huecos reales de Calendly del closer (o manual) */}
      {showReschedule && (
        <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/40">
          <p className="text-sm font-medium text-foreground">Reprogramar agenda</p>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Zona horaria del contacto (esta es la que verá el lead en la confirmación de Calendly, no la tuya)
            </p>
            <select value={rsContactTimezone} onChange={(e) => setRsContactTimezone(e.target.value)} className={cls}>
              {!TIMEZONE_OPTIONS.some((o) => o.value === rsContactTimezone) && (
                <option value={rsContactTimezone}>{rsContactTimezone}</option>
              )}
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Modo manual: solo cuando hay closer (sin closer ya es siempre manual). Útil para
              reprogramar agendas ya pasadas, que Calendly no permite reprogramar. */}
          {appointment.closer_id && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={rsManualMode}
                onChange={(e) => {
                  setRsManualMode(e.target.checked)
                  setRsSelectedSlot('')
                }}
                className="accent-brand-500"
              />
              Reprogramar solo en la plataforma (sin crear evento en Calendly)
            </label>
          )}

          {!appointment.closer_id || rsManualMode ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                {rsManualMode
                  ? 'Modo manual: solo cambia la fecha aquí, en la plataforma. NO se crea ni mueve el evento en Google Calendar, y el lead NO recibirá el email de confirmación/enlace de Meet ni el recordatorio (eso lo manda Calendly y aquí no se le avisa). Avísale tú manualmente si hace falta.'
                  : 'Sin closer asignado: elige la nueva fecha y hora manualmente. Al no haber Calendly de por medio, tampoco se creará evento en Google Calendar ni se avisará al lead por email — avísale tú manualmente si hace falta.'}
              </p>
              <input
                type="datetime-local"
                value={rsManualDatetime}
                onChange={(e) => setRsManualDatetime(e.target.value)}
                className={cls}
              />
            </div>
          ) : (
            <>
              <CalendarPopover value={rsDate} onChange={setRsDate} placeholder="Elige un día" />
              {!rsDate && (
                <p className="text-xs text-muted-foreground">
                  Elige un día para ver los huecos disponibles del closer.
                </p>
              )}
              {rsDate && rsSlotsLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Cargando huecos de Calendly…
                </div>
              )}
              {rsDate && !rsSlotsLoading && rsHasCalendly === false && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-400">
                    {rsMsg || 'Este closer no tiene Calendly.'} Elige la hora manualmente.
                  </p>
                  <input
                    type="datetime-local"
                    value={rsManualDatetime}
                    onChange={(e) => setRsManualDatetime(e.target.value)}
                    className={cls}
                  />
                </div>
              )}
              {rsDate && !rsSlotsLoading && rsMsg && rsHasCalendly === null && (
                <p className="text-xs text-red-400">{rsMsg}</p>
              )}
              {rsDate &&
                !rsSlotsLoading &&
                rsHasCalendly === true &&
                (rsSlots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay huecos disponibles ese día. Prueba otra fecha.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                    {rsSlots.map((s) => {
                      const label = new Date(s.start_time).toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: userTimezone,
                      })
                      const active = rsSelectedSlot === s.start_time
                      return (
                        <button
                          key={s.start_time}
                          type="button"
                          onClick={() => setRsSelectedSlot(s.start_time)}
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
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowReschedule(false)
                resetRescheduleForm()
              }}
              disabled={rescheduling}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={submitReschedule}
              disabled={!canSubmitReschedule}
              className="bg-brand-600 hover:bg-brand-500"
            >
              {rescheduling ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Reprogramando…
                </>
              ) : (
                'Confirmar nueva hora'
              )}
            </Button>
          </div>
        </div>
      )}

      <Separator className="bg-muted" />

      {/* Fields */}
      <dl className="space-y-3">
        {appointment.contact_id && (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-sm text-muted-foreground shrink-0 w-36">Contacto</dt>
              <dd className="text-sm text-right">
                <a
                  href={`/${tenant}/crm/contactos/${appointment.contact_id}`}
                  className="text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm"
                >
                  {appointment.contacts?.full_name || 'Abrir ficha'}
                </a>
              </dd>
            </div>
            {appointment.contacts?.email && (
              <div className="flex justify-between gap-4">
                <dt className="text-sm text-muted-foreground shrink-0 w-36">Email</dt>
                <dd className="text-sm text-right">
                  <a
                    href={`/${tenant}/crm/contactos/${appointment.contact_id}`}
                    className="max-w-[15rem] break-all text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm"
                  >
                    {appointment.contacts.email}
                  </a>
                </dd>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-sm text-muted-foreground shrink-0 w-36">Closer</dt>
          <dd className="text-sm text-foreground text-right">
            {canReassignCloser && editingCloser ? (
              <Select
                defaultValue={appointment.closer_id ?? '__none__'}
                onValueChange={handleCloserChange}
                disabled={closerSaving}
                onOpenChange={(open) => {
                  if (!open) setEditingCloser(false)
                }}
              >
                <SelectTrigger className="w-44 h-8 bg-muted border-border text-xs ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="__none__" className="text-foreground">
                    — sin closer —
                  </SelectItem>
                  {(closers ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-foreground">
                      {c.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : canReassignCloser ? (
              <button
                type="button"
                onClick={() => setEditingCloser(true)}
                disabled={closerSaving}
                className="hover:underline hover:text-brand-400 disabled:opacity-60"
                title="Cambiar closer"
              >
                {closerSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                ) : (
                  (appointment.closer?.full_name ?? '—')
                )}
              </button>
            ) : (
              (appointment.closer?.full_name ?? '—')
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-sm text-muted-foreground shrink-0 w-36">Setter</dt>
          <dd className="text-sm text-foreground text-right">
            {canReassignSetter && editingSetter ? (
              <Select
                defaultValue={appointment.setter_id ?? '__none__'}
                onValueChange={handleSetterChange}
                disabled={setterSaving}
                onOpenChange={(open) => {
                  if (!open) setEditingSetter(false)
                }}
              >
                <SelectTrigger className="w-44 h-8 bg-muted border-border text-xs ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="__none__" className="text-foreground">
                    — sin setter —
                  </SelectItem>
                  {(setters ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-foreground">
                      {s.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : canReassignSetter ? (
              <button
                type="button"
                onClick={() => setEditingSetter(true)}
                disabled={setterSaving}
                className="hover:underline hover:text-brand-400 disabled:opacity-60"
                title="Cambiar setter"
              >
                {setterSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                ) : (
                  (appointment.setter?.full_name ?? '—')
                )}
              </button>
            ) : (
              (appointment.setter?.full_name ?? '—')
            )}
          </dd>
        </div>
        {appointment.contact_id && (
          <div className="flex justify-between gap-4">
            <dt className="text-sm text-muted-foreground shrink-0 w-36">Ficha de contacto</dt>
            <dd className="text-sm text-right">
              <a
                href={`/${tenant}/crm/contactos/${appointment.contact_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:underline"
              >
                Ver contacto completo →
              </a>
            </dd>
          </div>
        )}
        {fields.map((field) => (
          <div key={field.label} className="flex justify-between gap-4">
            <dt className="text-sm text-muted-foreground shrink-0 w-36">{field.label}</dt>
            <dd className="text-sm text-foreground text-right">{field.value || '—'}</dd>
          </div>
        ))}
      </dl>

      {/* Formulario / Cualificación (Calendly) */}
      {entradasFormulario.length > 0 && (
        <>
          <Separator className="bg-muted" />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Formulario / Cualificación</h4>
            {veredicto && (
              <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                <p className="text-foreground">
                  {/* `null` no es "no cualificada": es que el formulario no da para decidirlo. Pintarlo
                      como un "no" metería en el numerario de las no cualificadas a todo el que no contestó. */}
                  Cualificación de marketing:{' '}
                  <span className="font-medium">
                    {veredicto.cualificada === true
                      ? 'sí'
                      : veredicto.cualificada === false
                        ? 'no'
                        : 'no se puede saber con lo que contestó'}
                  </span>
                  <span className="ml-1 text-muted-foreground">(fiabilidad {veredicto.fiabilidad})</span>
                </p>
                {veredicto.motivos.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {veredicto.motivos.map((m, i) => (
                      <li key={i}>· {m}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <dl className="space-y-3">
              {entradasFormulario.map((entry, i) => (
                <div key={i} className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                  <dd className="text-sm text-foreground">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      {/* Historial de llamadas: todo el contacto (no solo esta agenda), para tener el contexto
          completo antes de llamar (incluida la info del formulario justo arriba). */}
      {appointment.contact_id && (
        <>
          <Separator className="bg-muted" />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Historial de llamadas
            </h4>
            <div className="space-y-2">
              <Select value={newActivityResult} onValueChange={setNewActivityResult}>
                <SelectTrigger className="w-full h-8 bg-muted border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {ACTIVITY_RESULT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-foreground">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end">
                <Button size="sm" onClick={submitActivity} disabled={postingActivity}>
                  {postingActivity ? 'Guardando…' : 'Registrar llamada'}
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2 max-h-56 overflow-y-auto">
              {loadingActivities && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando historial…
                </p>
              )}
              {!loadingActivities && activities.length === 0 && (
                <p className="text-xs text-muted-foreground">Sin llamadas registradas todavía.</p>
              )}
              {activities.map((a) => (
                <div key={a.id} className="border border-border rounded-lg p-2.5 bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <Badge className="border text-xs bg-brand-500/20 text-brand-400 border-brand-500/30">
                      {a.result ? ACTIVITY_RESULT_LABELS[a.result] || a.result : a.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)} · {a.author}
                    </span>
                  </div>
                  {a.notes && <p className="text-sm text-foreground mt-1.5">{a.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Payload crudo: plegado y solo para quien administra. Antes se volcaba abierto para
          cualquiera que pudiera ver la cita, encima justo debajo de las respuestas ya legibles, así
          que ocupaba media ficha con ruido técnico. */}
      {canSeeRawPayload &&
        appointment.raw_payload &&
        !(
          appointment.fathom_meeting_id ||
          appointment.transcript ||
          appointment.ai_summary ||
          appointment.ai_analyzed_at
        ) && (
          <>
            <Separator className="bg-muted" />
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Payload crudo del webhook
                <span className="ml-2 text-xs font-normal">(diagnóstico — las respuestas legibles están arriba)</span>
              </summary>
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                {JSON.stringify(appointment.raw_payload, null, 2)}
              </pre>
            </details>
          </>
        )}

      {/* Grabación + nota única de la llamada (editable) */}
      <Separator className="bg-muted" />
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Grabación de la llamada</h4>
          <input
            type="url"
            value={recordingUrl}
            onChange={(e) => setRecordingUrl(e.target.value)}
            aria-label="Enlace externo de grabación"
            placeholder="https://… (Drive, Zoom, Meet, Fathom)"
            className="w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus:border-brand-500"
          />
          {appointment.recording_url && (
            <a
              href={appointment.recording_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-400 hover:text-brand-300 mt-1 inline-block"
            >
              Abrir grabación ↗
            </a>
          )}
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Notas de la llamada</h4>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="¿Qué tal fue la reunión? Objeciones, próximos pasos, etc."
            className="w-full bg-muted border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus:border-brand-500 resize-y"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={saveNote} disabled={savingNote || !dirty}>
            {savingNote ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>

      {/* Grabación y transcripción (IA) */}
      <Separator className="bg-muted" />
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-foreground">Grabación y transcripción</h4>

        <div>
          <h5 className="text-xs font-medium text-muted-foreground mb-2">Fuente de transcripción (opcional)</h5>
          <input
            type="url"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            onBlur={saveTranscriptFields}
            aria-label="Enlace de Drive para transcripción"
            placeholder="https://drive.google.com/…"
            className={cls}
          />
        </div>

        <div>
          <h5 className="text-xs font-medium text-muted-foreground mb-2">
            Transcripción (pegar manualmente, opcional)
          </h5>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            onBlur={saveTranscriptFields}
            rows={5}
            placeholder="Pega aquí la transcripción de la llamada si ya la tienes…"
            className={`${cls} resize-y`}
          />
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={analyzeCall} disabled={analyzing}>
            {analyzing ? 'Transcribiendo y analizando… (puede tardar)' : 'Analizar llamada (IA)'}
          </Button>
        </div>

        {aiResult && (
          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Valoración de la llamada</p>
                <p className="text-lg font-semibold text-brand-400">
                  {aiResult.call_score !== null ? `${aiResult.call_score}/10` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Valoración del lead</p>
                <p className="text-lg font-semibold text-brand-400">
                  {aiResult.lead_score !== null ? `${aiResult.lead_score}/10` : '—'}
                </p>
              </div>
            </div>

            {aiResult.suggested_stage && (
              <div>
                <p className="text-xs text-muted-foreground">Etapa sugerida</p>
                <Badge className="border text-xs bg-brand-500/20 text-brand-400 border-brand-500/30 mt-1">
                  {aiResult.suggested_stage}
                </Badge>
              </div>
            )}

            {aiResult.summary && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Resumen</p>
                <p className="text-sm text-foreground">{aiResult.summary}</p>
              </div>
            )}

            {aiResult.objections.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Objeciones</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {aiResult.objections.map((o, i) => (
                    <li key={i} className="text-sm text-foreground">
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {aiResult.next_steps.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Próximos pasos</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {aiResult.next_steps.map((s, i) => (
                    <li key={i} className="text-sm text-foreground">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {aiResult.tasksCreated > 0 && (
              <p className="text-xs text-emerald-400">
                Se han creado {aiResult.tasksCreated} tareas asignadas al comercial.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
