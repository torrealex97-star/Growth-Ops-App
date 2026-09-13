'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Inbox, Loader2, Mic } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'

type Candidate = {
  id: string
  datetime?: string
  status?: string | null
  hasOtherCall?: boolean
  transcriptStatus?: string | null
  contactName?: string | null
  contactEmail?: string | null
  missing?: boolean
}

type ReviewItem = {
  id: string
  fathomMeetingId: string
  meetingStartedAt: string | null
  inviteeEmail: string | null
  recordingUrl: string | null
  reasonKind: 'ambigua' | 'sin_candidatos'
  reason: string
  status: 'pendiente' | 'resuelta' | 'descartada'
  createdAt: string
  resolvedAt: string | null
  resolved: Candidate | null
  candidates: Candidate[]
}

type Response = {
  status: string
  counts: { pendiente: number; resuelta: number; descartada: number }
  canResolve: boolean
  items: ReviewItem[]
}

const TABS = [
  { key: 'pendiente', label: 'Pendientes' },
  { key: 'resuelta', label: 'Resueltas' },
  { key: 'descartada', label: 'Descartadas' },
] as const

// Fecha y hora en un solo formato en toda la pantalla: comparar horas es justo lo que hace la
// persona al decidir, así que los minutos son imprescindibles.
function dateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
}

function minutesFrom(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a || !b) return null
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime())
  if (Number.isNaN(diff)) return null
  return `${Math.round(diff / 60000)} min de diferencia`
}

export default function FathomRevisionPage() {
  const tenant = useTenant()
  const [status, setStatus] = useState<(typeof TABS)[number]['key']>('pendiente')
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  // Cita elegida por caso. Sin valor por defecto A PROPÓSITO: preseleccionar una candidata sería
  // volver a elegir por la persona, que es lo que el matcher se niega a hacer.
  const [choice, setChoice] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/fathom-revision?status=${status}`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudo cargar la cola')
        setData(null)
        return
      }
      setData(j as Response)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tenant, status])

  useEffect(() => {
    void load()
  }, [load])

  async function resolve(item: ReviewItem, action: 'asignar' | 'descartar') {
    const appointmentId = choice[item.id]
    if (action === 'asignar' && !appointmentId) {
      setFeedback({ id: item.id, ok: false, text: 'Elige primero a qué cita pertenece la llamada.' })
      return
    }
    setWorking(item.id)
    setFeedback(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/fathom-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, appointmentId }),
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) {
        setFeedback({ id: item.id, ok: false, text: j.mensaje || j.error || 'No se pudo resolver' })
        return
      }
      setFeedback({ id: item.id, ok: true, text: mensajeDeExito(j) })
      await load()
    } catch (e) {
      setFeedback({ id: item.id, ok: false, text: e instanceof Error ? e.message : 'Error de conexión' })
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Llamadas sin atribuir</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Reuniones de Fathom que el sync no pudo asignar a una cita sin adivinar. Atribuir una llamada a la cita
          equivocada duplica la conversación en el análisis de IA, así que aquí decide una persona.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              aria-current={status === t.key ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === t.key ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {data ? <span className="ml-1.5 opacity-60">{data.counts[t.key]}</span> : null}
            </button>
          ))}
        </div>
        {data && !data.canResolve ? (
          <span className="text-muted-foreground text-xs">Solo admin o dirección pueden resolver casos.</span>
        ) : null}
      </div>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          <Inbox className="mx-auto mb-2 h-6 w-6 opacity-50" />
          {status === 'pendiente'
            ? 'No hay llamadas pendientes de atribuir. Los casos aparecen aquí solos cuando el sync de Fathom encuentra una reunión que encaja en más de una cita, o en ninguna.'
            : 'Nada en este estado.'}
        </div>
      ) : (
        <div className="space-y-4">
          {data.items.map((item) => (
            <article key={item.id} className="border-border bg-card space-y-4 rounded-xl border p-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-foreground flex items-center gap-2 text-sm font-medium">
                    <Mic className="h-4 w-4 shrink-0 opacity-70" />
                    {dateTime(item.meetingStartedAt)}
                    <span className="text-muted-foreground font-normal">· {item.inviteeEmail || 'sin email'}</span>
                  </div>
                  <p className="text-muted-foreground text-xs">{item.reason}</p>
                </div>
                <a
                  href={item.recordingUrl || item.fathomMeetingId}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                >
                  Abrir en Fathom <ExternalLink className="h-3 w-3" />
                </a>
              </header>

              {item.status !== 'pendiente' ? (
                <p className="text-muted-foreground text-sm">
                  {item.status === 'resuelta'
                    ? `Asignada a la cita de ${item.resolved?.contactName || 'contacto'} del ${dateTime(item.resolved?.datetime)}.`
                    : 'Descartada.'}{' '}
                  {dateTime(item.resolvedAt)}
                </p>
              ) : item.candidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No hay ninguna cita candidata: o el contacto no existe en el CRM, o no tiene ninguna cita cerca de esa
                  hora. Si la llamada debería estar en una cita concreta, créala primero en Agendas y vuelve aquí.
                </p>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="text-muted-foreground mb-1 text-xs">¿A qué cita pertenece esta llamada?</legend>
                  {item.candidates.map((c) => (
                    <label
                      key={c.id}
                      className={`border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                        choice[item.id] === c.id ? 'border-primary/60 bg-primary/5' : 'hover:bg-muted/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`candidate-${item.id}`}
                        value={c.id}
                        checked={choice[item.id] === c.id}
                        onChange={() => setChoice((prev) => ({ ...prev, [item.id]: c.id }))}
                        disabled={!data.canResolve || c.missing === true}
                        className="mt-1"
                      />
                      <span className="space-y-0.5">
                        <span className="text-foreground block">
                          {c.missing ? 'Cita ya borrada' : dateTime(c.datetime)}
                          {c.status ? <span className="text-muted-foreground"> · {c.status}</span> : null}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {c.contactName || c.contactEmail || 'sin contacto'}
                          {minutesFrom(c.datetime, item.meetingStartedAt)
                            ? ` · ${minutesFrom(c.datetime, item.meetingStartedAt)}`
                            : ''}
                        </span>
                        {c.hasOtherCall ? (
                          <span className="block text-xs text-amber-400">
                            Esta cita ya tiene otra llamada importada: asignarla aquí la pisaría, así que se rechaza.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {feedback?.id === item.id ? (
                <p className={`flex items-start gap-2 text-sm ${feedback.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {feedback.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  {feedback.text}
                </p>
              ) : null}

              {item.status === 'pendiente' && data.canResolve ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void resolve(item, 'asignar')}
                    disabled={working === item.id || !choice[item.id]}
                    className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    {working === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Asignar a esta cita
                  </button>
                  <button
                    onClick={() => void resolve(item, 'descartar')}
                    disabled={working === item.id}
                    className="border-border text-muted-foreground hover:text-foreground rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Descartar
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function mensajeDeExito(j: { accion?: string; transcripcion?: string }): string {
  if (j.accion === 'descartada') return 'Caso descartado.'
  if (j.transcripcion === 'importada') return 'Llamada asignada y transcripción importada.'
  if (j.transcripcion === 'la_reunion_no_tiene')
    return 'Llamada asignada. Esa reunión no tiene transcripción en Fathom.'
  // No se afirma que no haya transcripción: no se ha llegado a ver esa reunión.
  return 'Llamada asignada y enlazada. La reunión no apareció en las últimas 2.000 de Fathom, así que la transcripción queda pendiente.'
}
