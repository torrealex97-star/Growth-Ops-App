import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { findMeetingById, meetingSummary, meetingTranscript } from '@/lib/fathom/meetings'

export const runtime = 'nodejs'
// Resolver puede tener que recorrer varias páginas de la API de Fathom para recuperar la
// transcripción de una reunión antigua, así que no vale el timeout por defecto.
export const maxDuration = 120

// Cola de revisión de reuniones de Fathom que el sync NO pudo emparejar sin adivinar.
//
// POR QUÉ EXISTE ESTA RUTA. La cola (`fathom_match_review`) ya se llenaba correctamente, pero
// resolverla exigía entrar en la base de datos a mano: una tabla con casos pendientes que nadie
// puede cerrar es lo mismo que perder las llamadas. Aquí se leen los casos con sus candidatas
// legibles (contacto, hora, si la cita ya tiene otra llamada) y se resuelven eligiendo UNA cita.
//
// Lo que esta ruta NO hace: elegir por su cuenta. Esa es exactamente la decisión que el matcher se
// niega a tomar (ver lib/fathom/match.ts), y automatizarla aquí sería reintroducir el fallo por la
// puerta de atrás.

type ReviewRow = {
  id: string
  fathom_meeting_id: string
  meeting_started_at: string | null
  invitee_email: string | null
  recording_url: string | null
  candidate_appointment_ids: string[]
  reason_kind: 'ambigua' | 'sin_candidatos'
  reason: string
  status: 'pendiente' | 'resuelta' | 'descartada'
  resolved_appointment_id: string | null
  resolved_at: string | null
  created_at: string
}

type AppointmentRow = {
  id: string
  appointment_datetime: string
  status: string | null
  fathom_meeting_id: string | null
  transcript_status: string | null
  // PostgREST devuelve la relación embebida como objeto o como array de uno según el tipo generado,
  // así que se acepta las dos formas y se normaliza en un solo sitio (`contactOf`).
  contacts: Contact | Contact[] | null
}

type Contact = { full_name: string | null; email: string | null }

const contactOf = (row: AppointmentRow): Contact | null =>
  Array.isArray(row.contacts) ? (row.contacts[0] ?? null) : row.contacts

const VALID_STATUS = ['pendiente', 'resuelta', 'descartada'] as const

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET /api/[tenant]/evergreen/fathom-revision?status=pendiente
//
// Lectura para todo el equipo con sesión (mismo criterio que la política de SELECT de la tabla):
// ver qué llamadas están sin atribuir no es una decisión, es información de trabajo.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error

  const statusParam = new URL(req.url).searchParams.get('status') || 'pendiente'
  if (!VALID_STATUS.includes(statusParam as (typeof VALID_STATUS)[number])) {
    return NextResponse.json({ error: `Estado desconocido: ${statusParam}` }, { status: 400 })
  }

  const sb = serviceClient()
  try {
    const { data, error } = await sb
      .from('fathom_match_review')
      .select(
        'id,fathom_meeting_id,meeting_started_at,invitee_email,recording_url,candidate_appointment_ids,reason_kind,reason,status,resolved_appointment_id,resolved_at,created_at'
      )
      .eq('tenant_id', session.tenantId)
      .eq('status', statusParam)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const rows = (data ?? []) as ReviewRow[]

    // Las citas candidatas se piden en UNA consulta para todas las filas, no una por caso.
    const appointmentIds = [
      ...new Set(rows.flatMap((r) => [...r.candidate_appointment_ids, r.resolved_appointment_id]).filter(Boolean)),
    ] as string[]
    const appointments = await loadAppointments(sb, session.tenantId, appointmentIds)

    // Recuento de los tres estados para que la pantalla no tenga que pedir tres veces lo mismo.
    const { data: totals, error: totalsError } = await sb
      .from('fathom_match_review')
      .select('status')
      .eq('tenant_id', session.tenantId)
      .limit(5000)
    if (totalsError) throw totalsError
    const counts = { pendiente: 0, resuelta: 0, descartada: 0 }
    for (const row of (totals ?? []) as { status: keyof typeof counts }[]) {
      if (row.status in counts) counts[row.status]++
    }

    return NextResponse.json({
      status: statusParam,
      counts,
      canResolve: session.isSuperAdmin || session.role === 'admin' || session.role === 'director',
      items: rows.map((r) => ({
        id: r.id,
        fathomMeetingId: r.fathom_meeting_id,
        meetingStartedAt: r.meeting_started_at,
        inviteeEmail: r.invitee_email,
        recordingUrl: r.recording_url,
        reasonKind: r.reason_kind,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        resolved: r.resolved_appointment_id ? (appointments.get(r.resolved_appointment_id) ?? null) : null,
        candidates: r.candidate_appointment_ids.map((id) => appointments.get(id) ?? { id, missing: true }),
      })),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer la cola de revisión' },
      { status: 500 }
    )
  }
}

// POST /api/[tenant]/evergreen/fathom-revision
// { id, action: 'asignar' | 'descartar', appointmentId? }
//
// Escribe una transcripción en una cita: solo admin/director, igual que la política de escritura de
// la tabla y que el resto de decisiones sobre datos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Solo admin o dirección pueden resolver la cola' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string; appointmentId?: string }
  if (!body.id) return NextResponse.json({ error: 'Falta el id del caso' }, { status: 400 })
  if (body.action !== 'asignar' && body.action !== 'descartar') {
    return NextResponse.json({ error: 'La acción debe ser "asignar" o "descartar"' }, { status: 400 })
  }

  const sb = serviceClient()
  try {
    // El caso se lee filtrando por tenant: un id de otra subcuenta no existe para esta sesión.
    const { data: review, error: reviewError } = await sb
      .from('fathom_match_review')
      .select('id,fathom_meeting_id,status,candidate_appointment_ids')
      .eq('tenant_id', session.tenantId)
      .eq('id', body.id)
      .maybeSingle()
    if (reviewError) throw reviewError
    if (!review) return NextResponse.json({ error: 'Ese caso no existe en esta subcuenta' }, { status: 404 })
    const row = review as Pick<ReviewRow, 'id' | 'fathom_meeting_id' | 'status' | 'candidate_appointment_ids'>
    if (row.status !== 'pendiente') {
      return NextResponse.json({ error: `El caso ya está ${row.status}` }, { status: 409 })
    }

    if (body.action === 'descartar') {
      return NextResponse.json(await descartar(sb, session.tenantId, row.id, session.userId))
    }

    if (!body.appointmentId) {
      return NextResponse.json({ error: 'Falta la cita a la que asignar la llamada' }, { status: 400 })
    }
    return NextResponse.json(await asignar(sb, session.tenantId, row, body.appointmentId, session.userId, tenant))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo resolver el caso' }, { status: 500 })
  }
}

async function loadAppointments(
  sb: SupabaseClient,
  tenantId: string,
  ids: string[]
): Promise<
  Map<
    string,
    {
      id: string
      datetime: string
      status: string | null
      hasOtherCall: boolean
      transcriptStatus: string | null
      contactName: string | null
      contactEmail: string | null
    }
  >
> {
  const map = new Map<
    string,
    {
      id: string
      datetime: string
      status: string | null
      hasOtherCall: boolean
      transcriptStatus: string | null
      contactName: string | null
      contactEmail: string | null
    }
  >()
  if (ids.length === 0) return map
  const { data, error } = await sb
    .from('appointments')
    .select('id,appointment_datetime,status,fathom_meeting_id,transcript_status,contacts(full_name,email)')
    .eq('tenant_id', tenantId)
    .in('id', ids)
  if (error) throw error
  for (const a of (data ?? []) as AppointmentRow[]) {
    map.set(a.id, {
      id: a.id,
      datetime: a.appointment_datetime,
      status: a.status,
      // Que la cita ya tenga OTRA llamada importada es el dato que evita pisar una transcripción
      // ajena, así que viaja a la pantalla y se comprueba otra vez al escribir.
      hasOtherCall: !!a.fathom_meeting_id,
      transcriptStatus: a.transcript_status,
      contactName: contactOf(a)?.full_name ?? null,
      contactEmail: contactOf(a)?.email ?? null,
    })
  }
  return map
}

async function descartar(sb: SupabaseClient, tenantId: string, id: string, userId: string) {
  // `.eq('status', 'pendiente')` + `.select()`: si otra persona lo resolvió entre la lectura y esta
  // escritura, esto afecta a 0 filas y se dice, en vez de dar por hecho lo que no pasó.
  const { data, error } = await sb
    .from('fathom_match_review')
    .update({ status: 'descartada', resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .eq('status', 'pendiente')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Otra persona resolvió este caso antes.' }
  }
  return { ok: true, accion: 'descartada' as const }
}

async function asignar(
  sb: SupabaseClient,
  tenantId: string,
  row: Pick<ReviewRow, 'id' | 'fathom_meeting_id' | 'candidate_appointment_ids'>,
  appointmentId: string,
  userId: string,
  tenantSlug: string
) {
  // 1) La cita tiene que ser de esta subcuenta. Sin esta comprobación, un id de otra subcuenta
  // llegaría a un UPDATE con service_role, que no pasa por RLS.
  const { data: appt, error: apptError } = await sb
    .from('appointments')
    .select('id,fathom_meeting_id')
    .eq('tenant_id', tenantId)
    .eq('id', appointmentId)
    .maybeSingle()
  if (apptError) throw apptError
  if (!appt) return { ok: false, motivo: 'cita_inexistente', mensaje: 'Esa cita no existe en esta subcuenta.' }
  const target = appt as { id: string; fathom_meeting_id: string | null }

  // 2) No pisar la transcripción de otra llamada. Es el mismo error que se corrigió en el matcher,
  // solo que cometido a mano: la cita elegida ya tiene una llamada distinta importada.
  if (target.fathom_meeting_id && target.fathom_meeting_id !== row.fathom_meeting_id) {
    return {
      ok: false,
      motivo: 'cita_ocupada',
      mensaje: 'Esa cita ya tiene otra llamada importada. Elige otra o quita antes la que tiene.',
    }
  }

  // 3) Ni duplicar esta llamada en dos citas, que es exactamente el fallo que creó esta cola.
  const { data: yaUsada, error: yaUsadaError } = await sb
    .from('appointments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('fathom_meeting_id', row.fathom_meeting_id)
    .neq('id', appointmentId)
    .limit(1)
  if (yaUsadaError) throw yaUsadaError
  if (yaUsada && yaUsada.length > 0) {
    return {
      ok: false,
      motivo: 'llamada_ya_atribuida',
      mensaje: `Esta llamada ya está importada en otra cita (${(yaUsada[0] as { id: string }).id}).`,
    }
  }

  // 4) Recuperar la reunión en Fathom. La cola no guarda la transcripción a propósito (es el cuerpo
  // grande y no se sabía a dónde iría), así que se busca ahora. El sync NO la traerá después: en
  // cuanto el caso está en la cola, el sync lo salta para no pisar la decisión humana.
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const apiKey = cfg.FATHOM_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      motivo: 'sin_credencial',
      mensaje: `Falta FATHOM_API_KEY en Configuración › Integraciones de ${tenantSlug}: sin ella no se puede traer la transcripción.`,
    }
  }
  const meeting = await findMeetingById(apiKey, row.fathom_meeting_id)
  const transcript = meeting ? meetingTranscript(meeting) : null

  // 5) Escritura con `.select()`: RLS o un id obsoleto dejarían 0 filas SIN error.
  const { data: updated, error: updateError } = await sb
    .from('appointments')
    .update({
      recording_url: row.fathom_meeting_id,
      fathom_meeting_id: row.fathom_meeting_id,
      ...(meeting
        ? {
            ai_summary: meetingSummary(meeting),
            transcript,
            transcript_status: transcript ? 'listo' : 'no_aplica',
          }
        : // La reunión no apareció en las páginas recorridas: se deja el enlace y la cita marcada
          // como pendiente de transcribir. Decir "sin transcripción" sería afirmar algo no
          // comprobado.
          { transcript_status: 'pendiente' }),
    })
    .eq('tenant_id', tenantId)
    .eq('id', appointmentId)
    .select('id')
  if (updateError) throw updateError
  if (!updated || updated.length === 0) {
    return { ok: false, motivo: 'no_escrito', mensaje: 'La cita no se pudo actualizar (0 filas afectadas).' }
  }

  // 6) Solo ahora se cierra el caso. Si este paso falla, la cita queda escrita y el caso pendiente:
  // volver a resolverlo escribe lo mismo, así que es repetible sin daño. Al revés no lo sería.
  const { data: closed, error: closeError } = await sb
    .from('fathom_match_review')
    .update({
      status: 'resuelta',
      resolved_appointment_id: appointmentId,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', row.id)
    .eq('status', 'pendiente')
    .select('id')
  if (closeError) throw closeError

  return {
    ok: true,
    accion: 'asignada' as const,
    appointmentId,
    transcripcion: meeting ? (transcript ? 'importada' : 'la_reunion_no_tiene') : 'no_encontrada_en_fathom',
    cola: closed && closed.length > 0 ? 'cerrada' : 'ya_estaba_cerrada',
  }
}
