import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 300

import { decideMatch } from '@/lib/fathom/match'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { HISTORY_CAPABILITIES } from '@/lib/integrations/history'
import { runMetaAdsSync, runMetaDailySync, runMetaSync } from '@/lib/meta/sync'
import { fetchMeetingsPage, meetingId, meetingSummary, meetingTranscript } from '@/lib/fathom/meetings'

type Json = Record<string, unknown>

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireAdmin(tenant: string) {
  const t = await requireTenant(tenant)
  if ('error' in t) return t
  if (!['admin', 'director'].includes(t.role || '')) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return t
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

async function findOrCreateContact(sb: SupabaseClient, tenantId: string, source: Json) {
  const externalId = text(source.id) || text(source.contactId)
  const email = text(source.email)?.toLowerCase() || null
  const phone = text(source.phone)
  const firstName = text(source.firstName) || text(source.first_name)
  const lastName = text(source.lastName) || text(source.last_name)
  const fullName = text(source.name) || [firstName, lastName].filter(Boolean).join(' ') || 'Sin nombre'

  let row: { id: string } | null = null
  if (externalId) {
    const found = await sb
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_contact_id', externalId)
      .maybeSingle()
    row = found.data
  }
  if (!row && email) {
    const found = await sb.from('contacts').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle()
    row = found.data
  }
  if (!row && phone) {
    const found = await sb.from('contacts').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle()
    row = found.data
  }

  const values = {
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    country: text(source.country),
    lead_channel: text(source.source),
    ...(externalId ? { ghl_contact_id: externalId } : {}),
    last_seen_at: text(source.dateUpdated) || new Date().toISOString(),
  }
  if (row) {
    const { error } = await sb.from('contacts').update(values).eq('tenant_id', tenantId).eq('id', row.id)
    if (error) throw error
    return { id: row.id, created: false }
  }
  if (!email && !phone && !externalId) return null
  const { data, error } = await sb
    .from('contacts')
    .insert({ tenant_id: tenantId, ...values, first_seen_at: text(source.dateAdded) || new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw error
  return { id: data.id as string, created: true }
}

async function syncGhl(sb: SupabaseClient, tenantId: string, cfg: Record<string, string>) {
  const token = cfg.GHL_API_TOKEN
  const locationId = cfg.GHL_LOCATION_ID
  if (!token || !locationId) throw new Error('Faltan GHL_API_TOKEN o GHL_LOCATION_ID')
  const headers = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
  let startAfterId = ''
  let startAfter = ''
  let pages = 0
  let imported = 0
  let updated = 0
  let appointmentsImported = 0
  let appointmentsUpdated = 0
  while (pages < 100) {
    const url = new URL('https://services.leadconnectorhq.com/contacts/')
    url.searchParams.set('locationId', locationId)
    url.searchParams.set('limit', '100')
    if (startAfterId) url.searchParams.set('startAfterId', startAfterId)
    if (startAfter) url.searchParams.set('startAfter', startAfter)
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
    const body = (await response.json().catch(() => ({}))) as { contacts?: Json[]; meta?: Json; message?: string }
    if (!response.ok) throw new Error(body.message || `GHL respondió ${response.status}`)
    const contacts = body.contacts ?? []
    for (const contact of contacts) {
      const saved = await findOrCreateContact(sb, tenantId, contact)
      if (saved?.created) imported++
      else if (saved) updated++
    }
    pages++
    const last = contacts.at(-1)
    if (contacts.length < 100 || !last) break
    const nextId = text(last.id)
    const nextDate = Date.parse(text(last.dateAdded) || '')
    if (!nextId || !Number.isFinite(nextDate) || nextId === startAfterId) break
    startAfterId = nextId
    startAfter = String(nextDate)
  }

  const calendarsResponse = await fetch(
    `https://services.leadconnectorhq.com/calendars/?locationId=${encodeURIComponent(locationId)}`,
    { headers, signal: AbortSignal.timeout(20_000) }
  )
  const calendarsBody = (await calendarsResponse.json().catch(() => ({}))) as {
    calendars?: Json[]
    message?: string
  }
  if (!calendarsResponse.ok)
    throw new Error(calendarsBody.message || `GHL calendarios respondió ${calendarsResponse.status}`)
  const startTime = Date.UTC(new Date().getUTCFullYear() - 5, 0, 1)
  const endTime = Date.UTC(new Date().getUTCFullYear() + 1, 11, 31, 23, 59, 59)
  for (const calendar of calendarsBody.calendars ?? []) {
    const calendarId = text(calendar.id)
    if (!calendarId) continue
    const url = new URL('https://services.leadconnectorhq.com/calendars/events')
    url.searchParams.set('locationId', locationId)
    url.searchParams.set('calendarId', calendarId)
    url.searchParams.set('startTime', String(startTime))
    url.searchParams.set('endTime', String(endTime))
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
    const body = (await response.json().catch(() => ({}))) as { events?: Json[]; message?: string }
    if (!response.ok) throw new Error(body.message || `GHL agendas respondió ${response.status}`)
    for (const event of body.events ?? []) {
      if (event.deleted === true || text(event.type) === 'blockedSlot') continue
      const eventId = text(event.id)
      const ghlContactId = text(event.contactId)
      const startsAt = text(event.startTime)
      if (!eventId || !ghlContactId || !startsAt) continue
      const contact = await sb
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('ghl_contact_id', ghlContactId)
        .maybeSingle()
      if (!contact.data) continue
      const rawStatus = (text(event.appointmentStatus) || text(event.status) || 'scheduled').toLowerCase()
      const status =
        rawStatus === 'showed' || rawStatus === 'completed'
          ? 'show'
          : rawStatus === 'noshow'
            ? 'no_show'
            : rawStatus === 'cancelled' || rawStatus === 'canceled'
              ? 'cancelled'
              : rawStatus === 'confirmed'
                ? 'confirmed'
                : 'scheduled'
      const end = text(event.endTime)
      const duration = end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(startsAt)) / 60_000)) : null
      const values = {
        tenant_id: tenantId,
        external_source: 'ghl',
        external_id: eventId,
        contact_id: contact.data.id,
        appointment_datetime: new Date(startsAt).toISOString(),
        duration_minutes: duration,
        status,
        source: 'ghl',
        calendar_name: text(calendar.name) || 'GoHighLevel',
        raw_payload: event,
      }
      const existing = await sb
        .from('appointments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('external_id', eventId)
        .maybeSingle()
      if (existing.data) {
        const result = await sb.from('appointments').update(values).eq('tenant_id', tenantId).eq('id', existing.data.id)
        if (result.error) throw result.error
        appointmentsUpdated++
      } else {
        const result = await sb.from('appointments').insert(values)
        if (result.error) throw result.error
        appointmentsImported++
      }
    }
  }
  return { provider: 'ghl', pages, imported, updated, appointmentsImported, appointmentsUpdated }
}

async function syncCalendly(sb: SupabaseClient, tenantId: string, cfg: Record<string, string>) {
  const token = cfg.CALENDLY_API_TOKEN
  if (!token) throw new Error('Falta CALENDLY_API_TOKEN')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const meResponse = await fetch('https://api.calendly.com/users/me', { headers, signal: AbortSignal.timeout(15_000) })
  const me = (await meResponse.json().catch(() => ({}))) as { resource?: { uri?: string }; message?: string }
  if (!meResponse.ok || !me.resource?.uri) throw new Error(me.message || 'Calendly no devolvió el usuario')

  let pageToken = ''
  let pages = 0
  let imported = 0
  let updated = 0
  while (pages < 100) {
    const url = new URL('https://api.calendly.com/scheduled_events')
    url.searchParams.set('user', me.resource.uri)
    url.searchParams.set('count', '100')
    url.searchParams.set('sort', 'start_time:asc')
    if (pageToken) url.searchParams.set('page_token', pageToken)
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
    const body = (await response.json().catch(() => ({}))) as {
      collection?: Json[]
      pagination?: { next_page_token?: string | null }
      message?: string
    }
    if (!response.ok) throw new Error(body.message || `Calendly respondió ${response.status}`)
    for (const event of body.collection ?? []) {
      const uri = text(event.uri)
      if (!uri) continue
      const inviteesResponse = await fetch(`${uri}/invitees?count=100`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      const inviteesBody = (await inviteesResponse.json().catch(() => ({}))) as { collection?: Json[] }
      if (!inviteesResponse.ok) continue
      for (const invitee of inviteesBody.collection ?? []) {
        const contact = await findOrCreateContact(sb, tenantId, {
          name: invitee.name,
          email: invitee.email,
          phone: invitee.text_reminder_number,
          dateAdded: event.created_at,
        })
        if (!contact) continue
        const status = event.status === 'canceled' ? 'cancelled' : 'scheduled'
        const values = {
          tenant_id: tenantId,
          external_source: 'calendly',
          external_id: uri,
          contact_id: contact.id,
          appointment_datetime: text(event.start_time) || new Date().toISOString(),
          status,
          source: 'calendly',
          calendar_name: text(event.name) || 'Calendly',
          meeting_url: text((event.location as Json | undefined)?.join_url),
          reschedule_url: text(invitee.reschedule_url),
          raw_payload: { event, invitee },
        }
        const existing = await sb
          .from('appointments')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('external_id', uri)
          .maybeSingle()
        if (existing.data) {
          const result = await sb
            .from('appointments')
            .update(values)
            .eq('id', existing.data.id)
            .eq('tenant_id', tenantId)
          if (result.error) throw result.error
          updated++
        } else {
          const result = await sb.from('appointments').insert(values)
          if (result.error) throw result.error
          imported++
        }
      }
    }
    pages++
    pageToken = body.pagination?.next_page_token || ''
    if (!pageToken) break
  }
  return { provider: 'calendly', pages, imported, updated }
}

// Sincroniza las reuniones de Fathom hacia las citas.
//
// La decisión de A QUÉ cita pertenece cada reunión NO está aquí: está en lib/fathom/match.ts, que es
// una función pura y probada. Esta función solo lee, obedece y escribe.
//
// Lo que cambió respecto a la versión anterior: cuando había varias citas candidatas en una ventana
// de ±12 h, escribía la transcripción en TODAS. Eso duplicaba la misma llamada en N citas (el
// análisis de IA la contaba N veces), estampaba el mismo fathom_meeting_id en N filas y hacía que el
// re-sync siguiente pareciera idempotente habiendo dejado N-1 filas con una llamada que no ocurrió
// ahí. Ahora los casos dudosos van a fathom_match_review y los resuelve una persona.
//
// `dryRun` recorre y clasifica sin escribir nada: es la forma de ver qué haría antes de dejarlo.
async function syncFathom(
  sb: SupabaseClient,
  tenantId: string,
  cfg: Record<string, string>,
  opts: { dryRun?: boolean } = {}
) {
  const key = cfg.FATHOM_API_KEY
  if (!key) throw new Error('Falta FATHOM_API_KEY')
  const dryRun = opts.dryRun === true
  let cursor = ''
  let pages = 0
  const stats = {
    emparejadas: 0,
    ya_importadas: 0,
    a_revision_ambiguas: 0,
    a_revision_sin_candidatos: 0,
    // Ya estaban en la cola de una pasada anterior: ni se reprocesan ni se vuelven a anotar.
    ya_en_revision: 0,
    sin_identificador: 0,
  }
  // Muestra de lo que haría, para que el dry-run sea legible y no solo un recuento.
  const muestra: Array<{ reunion: string; decision: string; detalle?: string }> = []

  while (pages < 100) {
    const { items, nextCursor } = await fetchMeetingsPage(key, cursor)

    for (const meeting of items) {
      const fathomMeetingId = meetingId(meeting)
      if (!fathomMeetingId) {
        // Sin identificador estable no hay forma de ser idempotente ni de anotar el caso en la cola
        // sin duplicarlo en cada pasada, así que se cuenta y se deja fuera.
        stats.sin_identificador++
        continue
      }

      // Si ya está en la cola de revisión, no se vuelve a anotar ni se reprocesa: el humano manda.
      const enRevision = await sb
        .from('fathom_match_review')
        .select('id,status')
        .eq('tenant_id', tenantId)
        .eq('fathom_meeting_id', fathomMeetingId)
        .maybeSingle()
      if (enRevision.data) {
        // Una vez en la cola, manda la persona: no se reprocesa ni se reabre si ya la resolvió.
        stats.ya_en_revision++
        continue
      }

      const invitees = Array.isArray(meeting.calendar_invitees) ? (meeting.calendar_invitees as Json[]) : []
      const external = invitees.find((i) => i.is_external === true) || invitees[0]
      const email = text(external?.email)?.toLowerCase() ?? null
      const startedAt = text(meeting.scheduled_start_time) || text(meeting.recording_start_time)

      // Candidatas: las citas de ese contacto alrededor de la hora de la reunión. Se consulta una
      // ventana holgada y es el matcher quien aplica la ventana estricta — así la regla vive en un
      // solo sitio y se puede probar sin base de datos.
      let candidates: Array<{ id: string; appointmentDatetime: string; fathomMeetingId?: string | null }> = []
      if (email && startedAt) {
        const contact = await sb
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('email', email)
          .maybeSingle()
        if (contact.data) {
          const wide = 12 * 60 * 60 * 1000
          const { data, error } = await sb
            .from('appointments')
            .select('id,appointment_datetime,fathom_meeting_id')
            .eq('tenant_id', tenantId)
            .eq('contact_id', (contact.data as { id: string }).id)
            .gte('appointment_datetime', new Date(new Date(startedAt).getTime() - wide).toISOString())
            .lte('appointment_datetime', new Date(new Date(startedAt).getTime() + wide).toISOString())
          if (error) throw error
          candidates = (data ?? []).map((a) => {
            const row = a as { id: string; appointment_datetime: string; fathom_meeting_id: string | null }
            return {
              id: row.id,
              appointmentDatetime: row.appointment_datetime,
              fathomMeetingId: row.fathom_meeting_id,
            }
          })
        }
      }

      const decision = decideMatch({ fathomMeetingId, startedAt, email }, candidates)

      if (decision.kind === 'ya_importada') {
        stats.ya_importadas++
        continue
      }

      if (decision.kind === 'match') {
        stats.emparejadas++
        if (muestra.length < 20) muestra.push({ reunion: fathomMeetingId, decision: `emparejada (${decision.via})` })
        if (dryRun) continue
        const transcript = meetingTranscript(meeting)
        // .select() para no dar por escrito lo que RLS o un id obsoleto pudieron dejar en 0 filas.
        const { data: updated, error } = await sb
          .from('appointments')
          .update({
            recording_url: fathomMeetingId,
            ai_summary: meetingSummary(meeting),
            transcript,
            transcript_status: transcript ? 'listo' : 'no_aplica',
            fathom_meeting_id: fathomMeetingId,
          })
          .eq('tenant_id', tenantId)
          .eq('id', decision.appointmentId)
          .select('id')
        if (error) throw error
        if (!updated || updated.length === 0) {
          // La cita existía al consultar y no se pudo escribir: no se cuenta como emparejada.
          stats.emparejadas--
          stats.a_revision_sin_candidatos++
          if (!dryRun)
            await anotarRevision(sb, tenantId, fathomMeetingId, meeting, email, startedAt, {
              kind: 'sin_candidatos',
              reason: 'La cita elegida no se pudo actualizar (0 filas afectadas).',
              candidateIds: [decision.appointmentId],
            })
        }
        continue
      }

      // Ambigua o sin candidatos: a la cola, nunca una escritura a ciegas.
      if (decision.kind === 'ambigua') stats.a_revision_ambiguas++
      else stats.a_revision_sin_candidatos++
      if (muestra.length < 20) {
        muestra.push({ reunion: fathomMeetingId, decision: decision.kind, detalle: decision.reason })
      }
      if (!dryRun) {
        await anotarRevision(sb, tenantId, fathomMeetingId, meeting, email, startedAt, {
          kind: decision.kind,
          reason: decision.reason,
          candidateIds: decision.kind === 'ambigua' ? decision.candidateIds : [],
        })
      }
    }

    pages++
    cursor = nextCursor
    if (!cursor) break
  }

  return { provider: 'fathom', dryRun, pages, ...stats, muestra }
}

// Anota un caso dudoso en la cola. Idempotente por (tenant_id, fathom_meeting_id): un re-sync no
// añade duplicados, y si la entrada ya estaba resuelta no se reabre.
async function anotarRevision(
  sb: SupabaseClient,
  tenantId: string,
  fathomMeetingId: string,
  meeting: Json,
  email: string | null,
  startedAt: string | null,
  info: { kind: 'ambigua' | 'sin_candidatos'; reason: string; candidateIds: string[] }
) {
  const { error } = await sb.from('fathom_match_review').upsert(
    {
      tenant_id: tenantId,
      fathom_meeting_id: fathomMeetingId,
      meeting_started_at: startedAt,
      invitee_email: email,
      recording_url: text(meeting.share_url) || text(meeting.url),
      candidate_appointment_ids: info.candidateIds,
      reason_kind: info.kind,
      reason: info.reason,
    },
    { onConflict: 'tenant_id,fathom_meeting_id', ignoreDuplicates: true }
  )
  if (error) throw error
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireAdmin(tenant)
    if ('error' in auth) return auth.error
    const body = (await req.json().catch(() => ({}))) as { provider?: string; dryRun?: boolean }
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    const sb = serviceClient()
    // Meta se carga desde aquí para que el histórico entre por el mismo sitio que el resto: primero
    // las campañas, y después el gasto día a día pidiendo el MÁXIMO que Meta conserva (37 meses) en
    // vez de los 180 días del sync rutinario. Es una carga puntual que el usuario ha pedido
    // explícitamente, así que traer poco sería lo único que no tiene sentido.
    if (body.provider === 'meta') {
      // Credenciales EXPLÍCITAS de esta subcuenta (`cfg`). Antes esto llamaba a ensureConfig(), que
      // vuelca la config en process.env y deja ahí las credenciales de la última subcuenta que pasó
      // por la lambda; con la config pasada como argumento, lo que se sincroniza es lo guardado aquí.
      const dias = HISTORY_CAPABILITIES.meta.sinceDays
      const secrets = [cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET]
      const campañas = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta', trigger: 'historico', secrets },
        () => runMetaSync(sb, auth.tenantId, cfg),
        (r) => ({ rowsWritten: r.synced, failures: r.failures, detail: { cuentas: r.accounts } })
      )
      const diario = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta-daily', trigger: 'historico', secrets },
        () => runMetaDailySync(sb, auth.tenantId, cfg, dias),
        (r) => ({ rowsWritten: r.daysSynced, failures: r.failures, detail: { cuentas: r.accounts, dias } })
      )
      const anuncios = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta-ads', trigger: 'historico', secrets },
        () => runMetaAdsSync(sb, auth.tenantId, cfg),
        (r) => ({ rowsWritten: r.adsSynced, failures: r.failures, detail: { cuentas: r.accounts } })
      )
      return NextResponse.json({ provider: 'meta', campañas, diario, anuncios, sinceDays: dias })
    }
    if (body.provider === 'ghl') return NextResponse.json(await syncGhl(sb, auth.tenantId, cfg))
    if (body.provider === 'calendly') return NextResponse.json(await syncCalendly(sb, auth.tenantId, cfg))
    if (body.provider === 'fathom')
      return NextResponse.json(await syncFathom(sb, auth.tenantId, cfg, { dryRun: body.dryRun === true }))
    return NextResponse.json({ error: 'Proveedor no soportado' }, { status: 400 })
  } catch (error) {
    if (error instanceof SyncBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
