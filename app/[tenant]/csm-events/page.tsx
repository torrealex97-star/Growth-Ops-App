'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { activeUserNamesQuery } from '@/lib/users'
import { CalendarCheck, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { SearchBox, normalizeText } from '@/components/ui/search-box'

const STATUSES = [
  { value: 'agendado', label: 'Agendado' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'completado', label: 'Completado' },
  { value: 'no_show', label: 'No show' },
  { value: 'reagendado', label: 'Reagendado' },
] as const

const TYPES = [
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'coaching', label: 'Coaching' },
  { value: 'revision', label: 'Revisión' },
  { value: 'graduacion', label: 'Graduación' },
  { value: 'soporte', label: 'Soporte' },
  { value: 'otro', label: 'Otro' },
] as const

type CsmEventRow = {
  id: string
  contact_id: string
  sale_id: string | null
  csm_id: string | null
  type: string
  event_datetime: string
  status: string
  grade: number | null
  success: 'si' | 'no' | 'parcial' | null
  reminder: string | null
  recording_url: string | null
  notes: string | null
  created_by: string | null
  contacts?: { full_name: string } | null
  csm?: { full_name: string } | null
}

type DbUser = { id: string; full_name: string }
type DbContact = { id: string; full_name: string }

export default function CsmEventsPage() {
  const [items, setItems] = useState<CsmEventRow[]>([])
  const [contacts, setContacts] = useState<DbContact[]>([])
  const [csmUsers, setCsmUsers] = useState<DbUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [ne, setNe] = useState({ contact_id: '', csm_id: '', type: 'onboarding', event_datetime: '', notes: '' })
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])

  const filteredItems = useMemo(() => items.filter((e) => inPeriod(e.event_datetime, range)), [items, range])

  const [q, setQ] = useState('')
  const visibleItems = useMemo(() => {
    const nq = normalizeText(q.trim())
    if (!nq) return filteredItems
    return filteredItems.filter(
      (e) =>
        normalizeText(e.contacts?.full_name || '').includes(nq) || normalizeText(e.csm?.full_name || '').includes(nq)
    )
  }, [filteredItems, q])

  const load = async () => {
    const supabase = createClient()
    const [eRes, uRes] = await Promise.all([
      supabase
        .from('csm_events')
        .select('*, contacts(full_name), csm:csm_id(full_name)')
        .order('event_datetime', { ascending: false }),
      activeUserNamesQuery(supabase),
    ])
    setItems((eRes.data as CsmEventRow[]) || [])
    setCsmUsers((uRes.data as DbUser[]) || [])

    let { data: cData } = await supabase
      .from('contacts')
      .select('id, full_name')
      .eq('lead_status', 'cliente')
      .order('full_name')
    if (!cData || cData.length === 0) {
      const fallback = await supabase.from('contacts').select('id, full_name').order('full_name').limit(200)
      cData = fallback.data
    }
    setContacts((cData as DbContact[]) || [])

    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const move = async (id: string, status: string) => {
    setItems((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)))
    const supabase = createClient()
    const { error } = await supabase.from('csm_events').update({ status }).eq('id', id)
    if (error) toast.error('No se pudo mover')
  }

  const create = async () => {
    if (!ne.contact_id) {
      toast.error('Selecciona un alumno')
      return
    }
    if (!ne.event_datetime) {
      toast.error('Selecciona fecha y hora')
      return
    }
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('csm_events').insert({
      contact_id: ne.contact_id,
      csm_id: ne.csm_id || null,
      type: ne.type,
      event_datetime: new Date(ne.event_datetime).toISOString(),
      notes: ne.notes || null,
      status: 'agendado',
      created_by: user?.id,
    })
    if (error) {
      toast.error('Error al crear', { description: error.message })
      return
    }
    toast.success('Evento creado')
    setShowNew(false)
    setNe({ contact_id: '', csm_id: '', type: 'onboarding', event_datetime: '', notes: '' })
    load()
  }

  const kpis = useMemo(() => {
    const now = new Date()
    const thisMonth = filteredItems.filter((e) => {
      const d = new Date(e.event_datetime)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
    const completados = filteredItems.filter((e) => e.status === 'completado')
    // OJO: esto es `csm_events.status`, NO `appointments.status`. Comparte el literal 'no_show' por
    // casualidad de vocabulario, pero es otra entidad y otro ciclo de vida. NO usar aquí `isNoShow()`
    // de lib/appointments/status: unificarlo ataría el cálculo de CSM a la semántica de las citas.
    const noShows = filteredItems.filter((e) => e.status === 'no_show')
    const showRate =
      completados.length + noShows.length > 0 ? (completados.length / (completados.length + noShows.length)) * 100 : 0
    const gradesArr = completados.filter((e) => e.grade != null).map((e) => e.grade as number)
    const avgGrade = gradesArr.length > 0 ? gradesArr.reduce((a, b) => a + b, 0) / gradesArr.length : 0
    const exitosos = completados.filter((e) => e.success === 'si')
    const successRate = completados.length > 0 ? (exitosos.length / completados.length) * 100 : 0
    return {
      thisMonth: thisMonth.length,
      showRate,
      avgGrade,
      successRate,
    }
  }, [filteredItems])

  const funnelKpis = useMemo(() => {
    const booked = filteredItems.length
    const completados = filteredItems.filter((e) => e.status === 'completado')
    const live = completados.length
    const success = filteredItems.filter((e) => e.success === 'si')
    const successful = success.length
    const canceladosAdmin = filteredItems.filter((e) => e.status === 'cancelado_admin').length
    const canceladosAlumno = filteredItems.filter((e) => e.status === 'cancelado_alumno').length
    const canceladosTotal = canceladosAdmin + canceladosAlumno
    const pctCancelTotal = booked > 0 ? (canceladosTotal / booked) * 100 : 0
    const pctCancelAdmin = booked > 0 ? (canceladosAdmin / booked) * 100 : 0
    const pctCancelAlumno = booked > 0 ? (canceladosAlumno / booked) * 100 : 0

    const noShows = filteredItems.filter((e) => e.status === 'no_show').length
    const pctShowRate = live + noShows > 0 ? (live / (live + noShows)) * 100 : 0

    const agendados = filteredItems.filter((e) => e.status === 'agendado').length
    const confirmados = filteredItems.filter((e) => e.status === 'confirmado').length
    const pctConfirm = agendados > 0 ? (confirmados / agendados) * 100 : 0

    const gradesArr = completados.filter((e) => e.grade != null).map((e) => e.grade as number)
    const avgEventGrade = gradesArr.length > 0 ? gradesArr.reduce((a, b) => a + b, 0) / gradesArr.length : 0

    const exitososEnCompletados = completados.filter((e) => e.success === 'si').length
    const pctLiveToSuccess = live > 0 ? (exitososEnCompletados / live) * 100 : 0

    return {
      booked,
      live,
      successful,
      pctCancelTotal,
      pctCancelAdmin,
      pctCancelAlumno,
      pctShowRate,
      pctConfirm,
      avgEventGrade,
      pctLiveToSuccess,
    }
  }, [filteredItems])

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-brand-400" /> Eventos CSM
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Onboarding, coaching, revisiones y graduación de alumnos</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar alumno o CSM..." className="w-64" />
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Nuevo evento
          </button>
        </div>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onClear={() => {
          setPeriodPreset('all')
          setCustomFrom('')
          setCustomTo('')
          setQ('')
        }}
        hasActiveFilters={periodPreset !== 'all' || q.trim() !== ''}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Eventos este mes</p>
          <p className="text-2xl font-bold text-foreground mt-1">{kpis.thisMonth}</p>
        </div>
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Show Rate</p>
          <p className="text-2xl font-bold text-foreground mt-1">{kpis.showRate.toFixed(0)}%</p>
        </div>
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Grade medio</p>
          <p className="text-2xl font-bold text-foreground mt-1">{kpis.avgGrade.toFixed(1)}</p>
        </div>
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">% Éxito</p>
          <p className="text-2xl font-bold text-foreground mt-1">{kpis.successRate.toFixed(0)}%</p>
        </div>
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Embudo de eventos CSM</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Booked Events</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.booked}</p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Live Events</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.live}</p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Successful Events</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.successful}</p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">%Cancel(E)</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.pctCancelTotal.toFixed(0)}%</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Admin {funnelKpis.pctCancelAdmin.toFixed(0)}% · Alumno {funnelKpis.pctCancelAlumno.toFixed(0)}%
            </p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">%Show Rate(E)</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.pctShowRate.toFixed(0)}%</p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">%Confirm(E)</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.pctConfirm.toFixed(0)}%</p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Avg Event Grade</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.avgEventGrade.toFixed(1)}</p>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">%Live(E)→Success</p>
            <p className="text-2xl font-bold text-foreground mt-1">{funnelKpis.pctLiveToSuccess.toFixed(0)}%</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : visibleItems.length === 0 ? (
        <div className="bg-card/50 border border-border rounded-lg p-10 text-center">
          <CalendarCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {filteredItems.length === 0
              ? 'Aún no hay eventos CSM registrados.'
              : 'Ningún evento coincide con la búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {STATUSES.map((col) => {
            const cards = visibleItems.filter((e) => e.status === col.value)
            return (
              <div key={col.value} className="bg-card/50 border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">{col.label}</h3>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.map((e) => (
                    <div key={e.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-foreground leading-snug">{e.contacts?.full_name || '—'}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {TYPES.find((t) => t.value === e.type)?.label}
                        </span>
                      </div>
                      {e.csm?.full_name && <p className="text-xs text-muted-foreground">CSM: {e.csm.full_name}</p>}
                      <p className="text-xs text-muted-foreground">
                        📅{' '}
                        {new Date(e.event_datetime).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                      {e.grade != null && <p className="text-xs text-muted-foreground">Grade: {e.grade}/10</p>}
                      {e.notes && <p className="text-xs text-muted-foreground line-clamp-2">{e.notes}</p>}
                      <select
                        value={e.status}
                        onChange={(ev) => move(e.id, ev.target.value)}
                        className="w-full text-xs rounded border border-border bg-muted text-foreground px-2 py-1"
                      >
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {cards.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">—</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowNew(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nuevo evento CSM</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={ne.contact_id}
              onChange={(e) => setNe({ ...ne, contact_id: e.target.value })}
              className={cls}
            >
              <option value="">— selecciona alumno —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select value={ne.csm_id} onChange={(e) => setNe({ ...ne, csm_id: e.target.value })} className={cls}>
                <option value="">— CSM —</option>
                {csmUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              <select value={ne.type} onChange={(e) => setNe({ ...ne, type: e.target.value })} className={cls}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="datetime-local"
              value={ne.event_datetime}
              onChange={(e) => setNe({ ...ne, event_datetime: e.target.value })}
              className={cls}
            />
            <textarea
              value={ne.notes}
              onChange={(e) => setNe({ ...ne, notes: e.target.value })}
              rows={2}
              placeholder="Notas"
              className={cls}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button onClick={create} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
