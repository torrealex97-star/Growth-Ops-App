import type { SupabaseClient } from '@supabase/supabase-js'
import { ESTADOS_SIN_RESOLVER } from '@/lib/appointments/status'
import { buscarContactoPorEmail } from '@/lib/contacts/buscar'
import { decideMatch } from '@/lib/fathom/match'
import { meetingId, meetingSummary, meetingTranscript, type FathomMeeting } from '@/lib/fathom/meetings'

// Ingesta de UNA reunión de Fathom: la ÚNICA implementación, usada por
//   · el botón de histórico (settings/integraciones/history-sync → syncFathom), que pagina la API,
//   · el webhook entrante (webhooks/fathom), que recibe la reunión ya servida por Fathom.
// Nació como código privado del botón; duplicarla para el webhook habría creado dos versiones que
// divergen — exactamente la deriva que dejó la ingesta de agendas muerta durante días sin que nadie
// la viera. La regla de fondo es la misma que en el resto de ingestas: ante la duda, no se decide,
// se encola (fathom_match_review); nunca una escritura a ciegas.

type Json = Record<string, unknown>

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** Resultado de procesar una reunión: las claves son los contadores que reporta el histórico. */
export type ResultadoIngesta =
  | { kind: 'sin_identificador' }
  | { kind: 'ya_en_revision' }
  | { kind: 'ya_importadas' }
  | { kind: 'emparejadas'; via?: string }
  | { kind: 'a_revision_ambiguas'; razon: string; candidateIds: string[] }
  | { kind: 'a_revision_sin_candidatos'; razon: string; candidateIds: string[] }

export async function procesarMeetingFathom(
  sb: SupabaseClient,
  tenantId: string,
  meeting: FathomMeeting,
  opts: { dryRun?: boolean } = {}
): Promise<ResultadoIngesta> {
  const dryRun = opts.dryRun === true
  const fathomMeetingId = meetingId(meeting)
  if (!fathomMeetingId) {
    // Sin identificador estable no hay forma de ser idempotente ni de anotar el caso en la cola
    // sin duplicarlo en cada pasada, así que se cuenta y se deja fuera.
    return { kind: 'sin_identificador' }
  }

  // Si ya está en la cola de revisión, no se vuelve a anotar ni se reprocesa: una vez en la cola,
  // manda la persona (no se reabre si ya la resolvió).
  const enRevision = await sb
    .from('fathom_match_review')
    .select('id,status')
    .eq('tenant_id', tenantId)
    .eq('fathom_meeting_id', fathomMeetingId)
    .maybeSingle()
  if (enRevision.data) return { kind: 'ya_en_revision' }

  const invitees = Array.isArray(meeting.calendar_invitees) ? (meeting.calendar_invitees as Json[]) : []
  const external = invitees.find((i) => i.is_external === true) || invitees[0]
  const email = text(external?.email)?.toLowerCase() ?? null
  const startedAt = text(meeting.scheduled_start_time) || text(meeting.recording_start_time)

  // Candidatas: las citas de ese contacto alrededor de la hora de la reunión. Se consulta una
  // ventana holgada y es el matcher quien aplica la ventana estricta — así la regla vive en un
  // solo sitio y se puede probar sin base de datos.
  let candidates: Array<{ id: string; appointmentDatetime: string; fathomMeetingId?: string | null }> = []
  if (email && startedAt) {
    const contact = await sb.from('contacts').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle()
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

  // La decisión la toma el matcher, no la ingesta.
  const decision = decideMatch({ fathomMeetingId, startedAt, email }, candidates)

  if (decision.kind === 'ya_importada') return { kind: 'ya_importadas' }

  if (decision.kind === 'match') {
    if (dryRun) return { kind: 'emparejadas', via: decision.via }
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

    // LA GRABACIÓN PRUEBA QUE LA LLAMADA OCURRIÓ: la cita pasa a "asistió".
    //
    // Va en una escritura APARTE y acotada a los estados sin resolver (ver debeMarcarAsistencia):
    // así nunca pisa una decisión humana —un "no asistió" puesto a mano, una cita cancelada— y si
    // esta segunda escritura fallara, la grabación y la transcripción ya están guardadas.
    const { error: errorAsistencia } = await sb
      .from('appointments')
      .update({ status: 'show' })
      .eq('tenant_id', tenantId)
      .eq('id', decision.appointmentId)
      .in('status', ESTADOS_SIN_RESOLVER)
    if (errorAsistencia) {
      // No se interrumpe la ingesta por esto: el dato principal ya entró.
      console.warn('[fathom] no se pudo marcar la asistencia:', errorAsistencia.message)
    }
    if (!updated || updated.length === 0) {
      // La cita existía al consultar y no se pudo escribir: no se cuenta como emparejada.
      const razon = 'La cita elegida no se pudo actualizar (0 filas afectadas).'
      await anotarRevision(sb, tenantId, fathomMeetingId, meeting, email, startedAt, {
        kind: 'sin_candidatos',
        reason: razon,
        candidateIds: [decision.appointmentId],
      })
      return { kind: 'a_revision_sin_candidatos', razon, candidateIds: [decision.appointmentId] }
    }
    return { kind: 'emparejadas', via: decision.via }
  }

  // Ambigua o sin candidatos: a la cola, nunca una escritura a ciegas.
  if (!dryRun) {
    await anotarRevision(sb, tenantId, fathomMeetingId, meeting, email, startedAt, {
      kind: decision.kind === 'ambigua' ? 'ambigua' : 'sin_candidatos',
      reason: decision.reason,
      candidateIds: decision.kind === 'ambigua' ? decision.candidateIds : [],
    })
  }
  return decision.kind === 'ambigua'
    ? { kind: 'a_revision_ambiguas', razon: decision.reason, candidateIds: decision.candidateIds }
    : { kind: 'a_revision_sin_candidatos', razon: decision.reason, candidateIds: [] }
}

/** Anota un caso dudoso en la cola. Idempotente por (tenant_id, fathom_meeting_id): un re-sync no
 *  añade duplicados, y si la entrada ya estaba resuelta no se reabre. */
async function anotarRevision(
  sb: SupabaseClient,
  tenantId: string,
  fathomMeetingId: string,
  meeting: FathomMeeting,
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
