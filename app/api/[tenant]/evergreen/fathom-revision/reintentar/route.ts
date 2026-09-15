import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { decideMatch, MATCH_WINDOW_MINUTES, type Candidate } from '@/lib/fathom/match'

export const runtime = 'nodejs'
export const maxDuration = 60

// REINTENTAR EL EMPAREJAMIENTO DE LA COLA DE FATHOM, sin decidir nada a mano.
//
// POR QUÉ HACE FALTA. La cola se llena con reuniones cuyo motivo dominante es "no hay ninguna cita de
// ese contacto cerca de esa hora". Eso NO significa que no exista: significa que no existía CUANDO
// llegó la reunión. Calendly y GHL sincronizan por su cuenta, y una cita que entra media hora después
// deja la reunión atascada para siempre aunque el emparejamiento ya sería evidente. La cola solo
// avanzaba si alguien la abría y resolvía caso por caso.
//
// LO QUE ESTO NO HACE, a propósito: no baja el listón. Se vuelve a llamar a `decideMatch` con las
// MISMAS reglas —email, ventana de 90 minutos, margen de desempate—, y solo se resuelven las que
// ahora salen limpias. Las ambiguas siguen en la cola, porque elegir una de dos citas a la misma hora
// es adivinar, y adivinar en atribución corrompe datos que luego nadie sabe de dónde salieron.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.isSuperAdmin && !['admin', 'director'].includes(auth.role ?? '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: pendientes, error: colaError } = await sb
    .from('fathom_match_review')
    .select('id, fathom_meeting_id, meeting_started_at, invitee_email, recording_url')
    .eq('tenant_id', auth.tenantId)
    .eq('status', 'pendiente')
    .limit(1000)
  if (colaError) return NextResponse.json({ error: colaError.message }, { status: 500 })

  const filas = pendientes ?? []
  if (filas.length === 0) return NextResponse.json({ ok: true, revisadas: 0, emparejadas: 0, siguenEnCola: 0 })

  // Los contactos de todos los emails de la cola, en UNA consulta. El email se compara normalizado,
  // que es como lo guarda `contacts.email_normalized`.
  const emails = [...new Set(filas.map((f) => (f.invitee_email ?? '').trim().toLowerCase()).filter(Boolean))]
  const { data: contactos } = await sb
    .from('contacts')
    .select('id, email_normalized')
    .eq('tenant_id', auth.tenantId)
    .in('email_normalized', emails)
  const contactoPorEmail = new Map((contactos ?? []).map((c) => [c.email_normalized as string, c.id as string]))

  // Y las citas de esos contactos, también en una. Sin esto sería una consulta por reunión.
  const contactIds = [...new Set(contactoPorEmail.values())]
  const { data: citas } = contactIds.length
    ? await sb
        .from('appointments')
        .select('id, contact_id, appointment_datetime, fathom_meeting_id')
        .eq('tenant_id', auth.tenantId)
        .in('contact_id', contactIds)
        .limit(5000)
    : { data: [] }
  const citasPorContacto = new Map<string, Candidate[]>()
  for (const c of citas ?? []) {
    const lista = citasPorContacto.get(c.contact_id as string) ?? []
    lista.push({
      id: c.id as string,
      appointmentDatetime: c.appointment_datetime as string,
      fathomMeetingId: (c.fathom_meeting_id as string | null) ?? null,
    })
    citasPorContacto.set(c.contact_id as string, lista)
  }

  let emparejadas = 0
  const errores: string[] = []
  for (const fila of filas) {
    const email = (fila.invitee_email ?? '').trim().toLowerCase()
    const contactId = email ? contactoPorEmail.get(email) : undefined
    const candidatos = contactId ? (citasPorContacto.get(contactId) ?? []) : []

    const decision = decideMatch(
      {
        fathomMeetingId: fila.fathom_meeting_id,
        startedAt: fila.meeting_started_at,
        email: email || null,
      },
      candidatos
    )
    // Solo se cierra la fila cuando la decisión es limpia. 'ambigua' y 'sin_candidatos' siguen
    // esperando a una persona, que es justo lo que deben hacer.
    if (decision.kind !== 'match' && decision.kind !== 'ya_importada') continue

    const cita = await sb
      .from('appointments')
      .update({
        fathom_meeting_id: fila.fathom_meeting_id,
        recording_url: fila.recording_url,
      })
      .eq('id', decision.appointmentId)
      .eq('tenant_id', auth.tenantId)
      .select('id')
    if (cita.error) {
      errores.push(`${fila.fathom_meeting_id}: ${cita.error.message}`)
      continue
    }
    const cerrada = await sb
      .from('fathom_match_review')
      .update({
        status: 'resuelta',
        resolved_appointment_id: decision.appointmentId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', fila.id)
      .eq('tenant_id', auth.tenantId)
      .select('id')
    if (cerrada.error) {
      errores.push(`${fila.fathom_meeting_id}: ${cerrada.error.message}`)
      continue
    }
    emparejadas++
  }

  return NextResponse.json({
    ok: true,
    revisadas: filas.length,
    emparejadas,
    siguenEnCola: filas.length - emparejadas,
    ventanaMinutos: MATCH_WINDOW_MINUTES,
    errores,
  })
}
