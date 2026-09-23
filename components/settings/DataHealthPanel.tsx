'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { DataHealthSummary } from '@/lib/types/tracking'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { TrackingSitesPanel } from '@/components/settings/TrackingSitesPanel'
import { formatPercent } from '@/lib/utils'

type EventRow = {
  id: string
  event_id: string
  event_name: string
  source: string
  occurred_at: string
  received_at: string
  processing_status: string
  rejection_reason: string | null
}

type DeliveryRow = {
  id: string
  destination: string
  status: string
  http_status: number | null
  latency_ms: number | null
  attempt_number: number
  last_error: string | null
  next_retry_at: string | null
  created_at: string
}
type DuplicateContact = { id: string; full_name: string | null; email: string | null; phone: string | null }
type DuplicateContactGroup = { key: string; primaryId: string; duplicateIds: string[]; contacts: DuplicateContact[] }
type DuplicateAppointmentGroup = { key: string; keepId: string; duplicateIds: string[] }
type SaludConector = {
  provider: string
  label: string
  comoEntra: string
  credenciales: { completas: boolean; faltan: string[] }
  ultima: {
    job: string
    estado: string
    empezoEn: string
    duracionMs: number | null
    filasEscritas: number | null
  } | null
  incidencia: { mensaje: string; codigo: string | null; seReintentaSolo: boolean } | null
  cursor: { soportado: boolean; motivo: string }
  estado: 'al_dia' | 'en_curso' | 'fallando' | 'sin_credenciales' | 'nunca_ejecutada'
}

type OperationalHealth = {
  conectores?: SaludConector[]
  conectoresPendientes?: string[]
  totals: { contacts: number; appointments: number }
  sources: Array<{
    id: string
    label: string
    configured: boolean
    records: number
    lastSeen: string | null
    status: 'connected' | 'needs_attention' | 'not_configured'
  }>
  integrity: {
    duplicateEmails: number
    duplicatePhones: number
    duplicateExternalAppointments: number
    duplicateContactTimes: number
    appointmentsWithoutContact: number
  }
}

const EMPTY: DataHealthSummary = {
  events: 0,
  matched: 0,
  pending: 0,
  rejected: 0,
  identityReview: 0,
  deliveryAttempts: 0,
  accepted: 0,
  failed: 0,
  lastReceivedAt: null,
}

const statusStyle: Record<string, string> = {
  processed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  matched: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  accepted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  received: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  retrying: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  deduplicated: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

const ESTADO_CONECTOR: Record<SaludConector['estado'], { texto: string; estilo: string }> = {
  al_dia: { texto: 'Al día', estilo: 'processed' },
  en_curso: { texto: 'En curso', estilo: 'received' },
  fallando: { texto: 'Fallando', estilo: 'failed' },
  // "Sin configurar" NO es un fallo: es una integración que esta subcuenta no usa. Pintarla en rojo
  // es lo que llenaba el historial de averías falsas.
  sin_credenciales: { texto: 'Sin configurar', estilo: 'deduplicated' },
  nunca_ejecutada: { texto: 'Nunca ejecutada', estilo: 'pending' },
}

function ConectorCard({ conector }: { conector: SaludConector }) {
  const estado = ESTADO_CONECTOR[conector.estado]
  const ultima = conector.ultima
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{conector.label}</p>
          <p className="text-xs text-muted-foreground">{conector.comoEntra}</p>
        </div>
        <Badge variant="outline" className={statusStyle[estado.estilo]}>
          {estado.texto}
        </Badge>
      </div>

      {!conector.credenciales.completas && (
        // Nombres de claves, nunca valores: lo que falta se dice por su nombre para poder ir a por ello.
        <p className="mt-3 text-xs text-muted-foreground">
          Falta configurar {conector.credenciales.faltan.join(', ')} en Integraciones.
        </p>
      )}

      {ultima && (
        <p className="mt-3 text-xs text-muted-foreground">
          Última pasada ({ultima.job}): {new Date(ultima.empezoEn).toLocaleString('es-ES')}
          {ultima.duracionMs !== null
            ? ` · ${Math.round(ultima.duracionMs / 1000)} s`
            : ' · se cortó, no se sabe cuánto duró'}
          {ultima.filasEscritas !== null ? ` · ${ultima.filasEscritas} filas` : ''}
        </p>
      )}

      {conector.incidencia && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2">
          <p className="text-xs text-red-300">{conector.incidencia.mensaje}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {conector.incidencia.seReintentaSolo
              ? 'Es un fallo de transporte: la próxima pasada puede arreglarlo sola.'
              : 'No se arregla solo: hay que tocar la configuración o la fuente.'}
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">{conector.cursor.motivo}</p>
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const colors = { neutral: 'text-foreground', good: 'text-emerald-400', warn: 'text-amber-400', bad: 'text-red-400' }
  return (
    <div className="border-l border-border pl-4 first:border-l-0 first:pl-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${colors[tone]}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

export function DataHealthPanel() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [summary, setSummary] = useState<DataHealthSummary>(EMPTY)
  const [events, setEvents] = useState<EventRow[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [operational, setOperational] = useState<OperationalHealth | null>(null)
  const [contactGroups, setContactGroups] = useState<DuplicateContactGroup[]>([])
  const [appointmentGroups, setAppointmentGroups] = useState<DuplicateAppointmentGroup[]>([])
  const [mergingKey, setMergingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const sb = createClient()
    const operationalRequest = fetch(`/api/${tenant}/evergreen/settings/data-health`)
    const dedupeRequest = fetch(`/api/${tenant}/evergreen/settings/data-health/dedupe`)
    const [
      eventCount,
      matchedCount,
      pendingCount,
      rejectedCount,
      reviewCount,
      deliveryCount,
      acceptedCount,
      failedCount,
      latestEvents,
      latestDeliveries,
    ] = await Promise.all([
      sb.from('canonical_events').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      sb
        .from('canonical_events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('processing_status', ['matched', 'processed']),
      sb
        .from('canonical_events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('processing_status', ['received', 'pending']),
      sb
        .from('canonical_events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('processing_status', 'rejected'),
      sb
        .from('identity_matches')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'needs_review'),
      sb.from('delivery_attempts').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      sb
        .from('delivery_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'accepted'),
      sb
        .from('delivery_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['failed', 'rejected']),
      sb
        .from('canonical_events')
        .select('id,event_id,event_name,source,occurred_at,received_at,processing_status,rejection_reason')
        .eq('tenant_id', tenantId)
        .order('received_at', { ascending: false })
        .limit(20),
      sb
        .from('delivery_attempts')
        .select('id,destination,status,http_status,latency_ms,attempt_number,last_error,next_retry_at,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const operationalResponse = await operationalRequest
    const operationalPayload = await operationalResponse.json().catch(() => null)
    const dedupeResponse = await dedupeRequest
    const dedupePayload = await dedupeResponse.json().catch(() => null)
    if (dedupeResponse.ok && dedupePayload) {
      setContactGroups(dedupePayload.contactGroups ?? [])
      setAppointmentGroups(dedupePayload.appointmentGroups ?? [])
    }
    const firstError = [
      eventCount,
      matchedCount,
      pendingCount,
      rejectedCount,
      reviewCount,
      deliveryCount,
      acceptedCount,
      failedCount,
      latestEvents,
      latestDeliveries,
    ].find((r) => r.error)?.error
    if (firstError || !operationalResponse.ok) {
      setError(firstError?.message || operationalPayload?.error || 'No se pudo calcular la salud de las fuentes')
    } else {
      setOperational(operationalPayload as OperationalHealth)
      const recent = (latestEvents.data ?? []) as EventRow[]
      setEvents(recent)
      setDeliveries((latestDeliveries.data ?? []) as DeliveryRow[])
      setSummary({
        events: eventCount.count ?? 0,
        matched: matchedCount.count ?? 0,
        pending: pendingCount.count ?? 0,
        rejected: rejectedCount.count ?? 0,
        identityReview: reviewCount.count ?? 0,
        deliveryAttempts: deliveryCount.count ?? 0,
        accepted: acceptedCount.count ?? 0,
        failed: failedCount.count ?? 0,
        lastReceivedAt: recent[0]?.received_at ?? null,
      })
    }
    setLoading(false)
  }, [tenant, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  async function mergeContactGroup(group: DuplicateContactGroup) {
    const primary = group.contacts.find((c) => c.id === group.primaryId)
    if (
      !window.confirm(
        `¿Fusionar ${group.duplicateIds.length} contacto(s) duplicado(s) en "${primary?.full_name || primary?.email || 'este contacto'}"? Se conservará todo el historial (ventas, agendas), solo se marcan los duplicados como fusionados.`
      )
    )
      return
    setMergingKey(group.key)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/data-health/dedupe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'contacts', primaryId: group.primaryId, duplicateIds: group.duplicateIds }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo fusionar')
      toast.success(`${group.duplicateIds.length} contacto(s) fusionado(s)`)
      await load()
    } catch (error) {
      toast.error('No se pudo fusionar', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setMergingKey(null)
    }
  }

  async function cleanAppointmentGroup(group: DuplicateAppointmentGroup) {
    if (
      !window.confirm(
        `¿Eliminar ${group.duplicateIds.length} agenda(s) duplicada(s) (misma fuente e ID externo — reingesta del mismo webhook)? Se conserva la más antigua.`
      )
    )
      return
    setMergingKey(group.key)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/data-health/dedupe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'appointments', keepId: group.keepId, duplicateIds: group.duplicateIds }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo limpiar')
      toast.success(`${group.duplicateIds.length} agenda(s) duplicada(s) eliminada(s)`)
      await load()
    } catch (error) {
      toast.error('No se pudo limpiar', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setMergingKey(null)
    }
  }

  const matchRate = summary.events ? (summary.matched / summary.events) * 100 : null
  const deliveryRate = summary.deliveryAttempts ? (summary.accepted / summary.deliveryAttempts) * 100 : null
  const stale = useMemo(
    () =>
      summary.lastReceivedAt ? Date.now() - new Date(summary.lastReceivedAt).getTime() > 24 * 60 * 60 * 1000 : false,
    [summary.lastReceivedAt]
  )

  return (
    <div className="space-y-6">
      {/* Pixel first-party (Fase C): alta de sites, snippet instalable y estado con datos reales. */}
      <TrackingSitesPanel />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-400" />
            <h1 className="text-2xl font-bold text-foreground">Data Health</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Eventos canónicos, resolución de identidad y entregas a destinos.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </header>

      {operational && (
        <>
          {operational.conectores && operational.conectores.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-foreground">Estado de las sincronizaciones</h2>
                  <p className="text-sm text-muted-foreground">
                    Sale del historial de ejecuciones, no de los datos guardados: dice si la tubería sigue abierta, no
                    cuándo entró el último dato bueno.
                  </p>
                </div>
                {operational.conectoresPendientes && operational.conectoresPendientes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {operational.conectoresPendientes.length} integraciones todavía sin contrato
                  </p>
                )}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {operational.conectores.map((c) => (
                  <ConectorCard key={c.provider} conector={c} />
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-semibold text-foreground">Fuentes conectadas</h2>
                <p className="text-sm text-muted-foreground">
                  Estado basado en credenciales y registros reales de esta subcuenta.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {operational.totals.contacts} contactos · {operational.totals.appointments} agendas
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {operational.sources.map((source) => (
                <div key={source.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{source.label}</p>
                    <Badge
                      variant="outline"
                      className={
                        source.status === 'connected'
                          ? statusStyle.processed
                          : source.status === 'needs_attention'
                            ? statusStyle.pending
                            : statusStyle.deduplicated
                      }
                    >
                      {source.status === 'connected'
                        ? 'Con datos'
                        : source.status === 'needs_attention'
                          ? 'Revisar'
                          : 'Sin configurar'}
                    </Badge>
                  </div>
                  <p className="mt-3 text-2xl font-semibold">{source.records}</p>
                  <p className="text-xs text-muted-foreground">
                    registros vinculados
                    {source.lastSeen ? ` · último ${new Date(source.lastSeen).toLocaleDateString('es-ES')}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Integridad y deduplicación</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Duplicados exactos normalizados; no confunde varias reuniones legítimas del mismo contacto.
            </p>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                label="Emails duplicados"
                value={String(operational.integrity.duplicateEmails)}
                detail="Exceso tras normalizar"
                tone={operational.integrity.duplicateEmails ? 'warn' : 'good'}
              />
              <Metric
                label="Teléfonos duplicados"
                value={String(operational.integrity.duplicatePhones)}
                detail="Exceso tras normalizar"
                tone={operational.integrity.duplicatePhones ? 'warn' : 'good'}
              />
              <Metric
                label="IDs externos"
                value={String(operational.integrity.duplicateExternalAppointments)}
                detail="Agendas repetidas por fuente"
                tone={operational.integrity.duplicateExternalAppointments ? 'bad' : 'good'}
              />
              <Metric
                label="Coincidencias contacto + hora"
                value={String(operational.integrity.duplicateContactTimes)}
                detail="Revisar: puede ser una reprogramación"
                tone={operational.integrity.duplicateContactTimes ? 'warn' : 'good'}
              />
              <Metric
                label="Sin contacto"
                value={String(operational.integrity.appointmentsWithoutContact)}
                detail="Agendas sin relación"
                tone={operational.integrity.appointmentsWithoutContact ? 'bad' : 'good'}
              />
            </div>
          </section>

          {(contactGroups.length > 0 || appointmentGroups.length > 0) && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">Duplicados detectados</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Fusionar conserva todo el historial (ventas, agendas, contratos) bajo el contacto primario; solo se
                marca el duplicado como fusionado, nunca se borra.
              </p>
              <div className="space-y-3">
                {contactGroups.map((group) => {
                  const primary = group.contacts.find((c) => c.id === group.primaryId)
                  const dupes = group.contacts.filter((c) => c.id !== group.primaryId)
                  return (
                    <div
                      key={group.key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="text-sm">
                        <p className="text-foreground">
                          <span className="font-medium">{primary?.full_name || primary?.email || primary?.phone}</span>{' '}
                          <span className="text-muted-foreground">se quedará como primario</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Duplicados: {dupes.map((d) => d.full_name || d.email || d.phone).join(', ')}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => mergeContactGroup(group)}
                        disabled={mergingKey === group.key}
                      >
                        {mergingKey === group.key ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : 'Fusionar'}
                      </Button>
                    </div>
                  )
                })}
                {appointmentGroups.map((group) => (
                  <div
                    key={group.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="text-sm">
                      <p className="text-foreground">
                        Agenda duplicada: <span className="font-mono text-xs">{group.key}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.duplicateIds.length} copia(s) de la misma reingesta de webhook — se conserva la más
                        antigua.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cleanAppointmentGroup(group)}
                      disabled={mergingKey === group.key}
                    >
                      {mergingKey === group.key ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : 'Limpiar'}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Eventos"
            value={loading ? '—' : String(summary.events)}
            detail="Recibidos en el contrato canónico"
          />
          <Metric
            label="Match rate"
            value={formatPercent(matchRate, 1)}
            detail={matchRate == null ? 'Sin eventos todavía' : 'Identidad utilizable / eventos'}
            tone={matchRate != null && matchRate < 70 ? 'warn' : 'good'}
          />
          <Metric
            label="Delivery rate"
            value={formatPercent(deliveryRate, 1)}
            detail={deliveryRate == null ? 'Sin intentos todavía' : 'Aceptados / intentos'}
            tone={deliveryRate != null && deliveryRate < 90 ? 'warn' : 'good'}
          />
          <Metric
            label="Revisión"
            value={loading ? '—' : String(summary.identityReview)}
            detail="Coincidencias ambiguas"
            tone={summary.identityReview ? 'warn' : 'neutral'}
          />
          <Metric
            label="Errores"
            value={loading ? '—' : String(summary.rejected + summary.failed)}
            detail="Rechazados o fallidos"
            tone={summary.rejected + summary.failed ? 'bad' : 'neutral'}
          />
        </div>
      </div>

      {error && (
        <div className="flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">No se pudo consultar Data Health</p>
            <p className="mt-1 text-red-300/80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && summary.events === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Tracking preparado, todavía sin eventos</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            No mostramos datos ficticios. Conecta una fuente al endpoint seguro de eventos para empezar a medir
            recepción, matching, deduplicación y entrega.
          </p>
          <code className="mt-4 inline-block rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
            POST /api/${tenant}/evergreen/tracking/events
          </code>
        </div>
      )}

      {stale && summary.events > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          <Clock3 className="h-5 w-5" /> No se reciben eventos desde hace más de 24 horas.
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold text-foreground">Eventos recientes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Evento</th>
                  <th>Fuente</th>
                  <th>Recibido</th>
                  <th className="pr-5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-border/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground">{event.event_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{event.event_id}</p>
                    </td>
                    <td className="text-muted-foreground">{event.source}</td>
                    <td className="text-muted-foreground">{new Date(event.received_at).toLocaleString('es-ES')}</td>
                    <td className="pr-5">
                      <Badge variant="outline" className={statusStyle[event.processing_status]}>
                        {event.processing_status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && events.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Sin eventos reales.</p>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold text-foreground">Intentos de entrega</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Destino</th>
                  <th>HTTP</th>
                  <th>Latencia</th>
                  <th>Intento</th>
                  <th className="pr-5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((row) => (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="px-5 py-3 font-medium text-foreground">{row.destination}</td>
                    <td className="text-muted-foreground">{row.http_status ?? '—'}</td>
                    <td className="text-muted-foreground">{row.latency_ms == null ? '—' : `${row.latency_ms} ms`}</td>
                    <td className="text-muted-foreground">#{row.attempt_number}</td>
                    <td className="pr-5">
                      <Badge variant="outline" className={statusStyle[row.status]}>
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && deliveries.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Sin entregas reales.</p>
          )}
        </div>
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        Esta pantalla solo presenta datos persistidos. No contiene demo data.
      </p>
    </div>
  )
}
