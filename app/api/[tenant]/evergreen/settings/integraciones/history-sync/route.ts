import { NextRequest, NextResponse } from 'next/server'
import { type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 60

import { decideMatch } from '@/lib/fathom/match'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { HISTORY_CAPABILITIES } from '@/lib/integrations/history'
// La implementación de las sincronizaciones de citas vive en lib/integrations/citas-sync: la usa
// también el cron diario (cron/calendly-ghl). Aquí solo quedan Fathom y el enrutado de proveedores —
// tener DOS copias de estas funciones (una por el botón, otra por el cron) es exactamente la deriva
// que dejó la ingesta de agendas muerta durante días sin que nadie lo viera.
import { serviceClient, syncCalendly, syncGhl, text } from '@/lib/integrations/citas-sync'
import { runMetaAdsSync, runMetaDailySync, runMetaSync } from '@/lib/meta/sync'
import { fetchMeetingsPage, meetingId, meetingSummary, meetingTranscript } from '@/lib/fathom/meetings'
import { buscarContactoPorEmail } from '@/lib/contacts/buscar'

type Json = Record<string, unknown>

async function requireAdmin(tenant: string) {
  const t = await requireTenant(tenant)
  if ('error' in t) return t
  if (!['admin', 'director'].includes(t.role || '')) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return t
}

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
  // El correo del asistente es PII. Se vincula al contacto si esa persona ya tiene ficha, para que
  // `erase_person` alcance la fila; si no la tiene, queda a NULL y NO se crea una ficha por un
  // correo que solo apareció en una reunión. Ver `docs/F6-MAPA-PII.md` §1.2.
  const contactId = await buscarContactoPorEmail(sb, tenantId, email)
  const { error } = await sb.from('fathom_match_review').upsert(
    {
      tenant_id: tenantId,
      fathom_meeting_id: fathomMeetingId,
      meeting_started_at: startedAt,
      invitee_email: email,
      contact_id: contactId,
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
