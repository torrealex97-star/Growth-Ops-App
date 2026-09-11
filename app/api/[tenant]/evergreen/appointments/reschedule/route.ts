import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { resolveCloserEventType, createInvitee, CalendlyError } from '@/lib/calendly'
import { formatDateTime } from '@/lib/utils'
import { notifyCreatuagente, toZonedISO, addMinutesISO } from '@/lib/creatuagente'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']

// POST /api/${tenant}/evergreen/appointments/reschedule
// Reprograma una agenda EXISTENTE sin duplicar contacto ni fila: actualiza la MISMA
// fila de `appointments` (mismo id). Si está enlazada a Calendly, crea el nuevo evento
// primero, actualiza la fila con los datos del nuevo evento (para que el webhook de
// Calendly reconcilie por external_id sobre esta misma fila) y solo al final cancela
// el evento antiguo en Calendly.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = (await req.json()) as {
      appointmentId?: string
      startTime?: string // ISO
      durationMinutes?: number
      timezone?: string // timezone del contacto (ej: 'America/New_York')
      manualOnly?: boolean // reprograma SOLO en la plataforma (no crea evento en Calendly)
    }
    const { appointmentId, startTime, timezone } = body
    if (!appointmentId) return NextResponse.json({ error: 'Falta appointmentId' }, { status: 400 })
    if (!startTime) return NextResponse.json({ error: 'Falta la nueva hora' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: urow } = await sb.from('users').select('data_scope, roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    const scope = (urow as { data_scope?: string } | null)?.data_scope || 'own'
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: appt } = await sb
      .from('appointments')
      .select('id, contact_id, closer_id, setter_id, external_source, calendly_event_uuid, appointment_datetime, duration_minutes, status, qualification, utm_source, utm_campaign, utm_term, utm_medium, utm_content, calendar_name')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })
    // Liderazgo y quien tiene visibilidad de equipo (data_scope='team') pueden reprogramar cualquier
    // agenda del equipo; el resto solo las suyas. Coherente con la RLS de SELECT.
    if (!LEADERSHIP.includes(role) && scope !== 'team' && appt.setter_id !== t.userId && appt.closer_id !== t.userId) {
      return NextResponse.json({ error: 'Solo puedes reprogramar tus propias agendas' }, { status: 403 })
    }

    const parsedDuration = body.durationMinutes && body.durationMinutes > 0 ? body.durationMinutes : appt.duration_minutes || 30
    const newDatetimeISO = new Date(startTime).toISOString()

    const oldValues = {
      appointment_datetime: appt.appointment_datetime,
      duration_minutes: appt.duration_minutes,
      status: appt.status,
    }
    // Etiqueta la reagenda como "no show" o "show" en el historial de llamadas del contacto,
    // según el status que tenía la cita justo antes de reprogramarla (ver migración v61).
    const priorStatusNote =
      appt.status === 'no_show' ? ' (no había asistido a la anterior)'
      : appt.status === 'show' ? ' (sí asistió a la anterior)'
      : ''

    // Caso 1: agenda enlazada a Calendly → crear el nuevo evento y cancelar el antiguo.
    // Se omite si el que reprograma pide modo manual (solo plataforma): p.ej. reprogramar
    // una agenda ya pasada (Calendly no deja reprogramar eventos pasados) o cuando el closer
    // no tiene Calendly. En ese caso solo se actualiza la fila (Caso 2 más abajo).
    if (!body.manualOnly && appt.external_source === 'calendly' && appt.calendly_event_uuid) {
      const { data: contact } = await sb
        .from('contacts')
        .select('id, full_name, first_name, last_name, email, phone, qualification')
        .eq('id', appt.contact_id)
        .eq('tenant_id', t.tenantId)
        .maybeSingle()
      if (!contact?.email) {
        return NextResponse.json({ error: 'El contacto necesita un email para reprogramar en Calendly' }, { status: 400 })
      }
      if (!appt.closer_id) {
        return NextResponse.json({ error: 'La agenda no tiene closer asignado' }, { status: 400 })
      }

      // Respuestas reales del formulario que el lead ya dio (en la cita que estamos
      // reagendando, o si no las tiene, el último snapshot guardado en el contacto).
      // Se reenvían a Calendly para no perder la cualificación real al crear el nuevo
      // evento (bug: sin esto, las preguntas obligatorias se rellenaban con placeholders
      // como "Por confirmar" y esos placeholders pisaban la cualificación real vía webhook).
      const apptQualification = appt.qualification as { respuestas?: Array<{ q: string; a: string }> } | null
      const contactQualification = contact.qualification as { respuestas?: Array<{ q: string; a: string }> } | null
      const priorAnswers =
        (Array.isArray(apptQualification?.respuestas) && apptQualification.respuestas.length > 0
          ? apptQualification.respuestas
          : contactQualification?.respuestas) || []
      const { data: closer } = await sb.from('users').select('email, calendly_email, full_name').eq('id', appt.closer_id).maybeSingle()
      if (!closer?.email) return NextResponse.json({ error: 'El closer no tiene email' }, { status: 400 })

      const et = await resolveCloserEventType(closer.calendly_email || closer.email)
      if (!et) {
        return NextResponse.json(
          { error: `${closer.full_name} no tiene un event type en la cuenta madre de Calendly` },
          { status: 400 }
        )
      }

      let result
      try {
        result = await createInvitee({
          eventType: et,
          startTimeISO: newDatetimeISO,
          invitee: {
            name: contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Sin nombre',
            email: contact.email,
            phone: contact.phone,
            timezone: timezone || 'Europe/Madrid',
          },
          // Reenvía la atribución ORIGINAL de la cita (p.ej. utm_source 'instagram-setting'/
          // 'facebook-setting' + utm_term 'IA' cuando la agendó el bot de Setting IA) en vez de
          // inventar utm_source:'app'. Si no, el webhook de Calendly pisa esa atribución real con
          // la marca interna de la reprogramación y el lead pasa a verse como "de la app" en
          // Atribución/Agendas, perdiendo de dónde vino de verdad. Incluye también utm_medium/
          // utm_content: si se omiten, Calendly los manda vacíos y el webhook los pisa a null.
          utm: {
            utm_source: appt.utm_source,
            utm_campaign: appt.utm_campaign,
            utm_term: appt.utm_term,
            utm_medium: appt.utm_medium,
            utm_content: appt.utm_content,
          },
          priorAnswers,
        })
      } catch (err) {
        if (err instanceof CalendlyError) {
          return NextResponse.json({ error: 'Calendly: ' + err.message, detail: err.body }, { status: 502 })
        }
        throw err
      }

      // Actualiza la MISMA fila con los datos del nuevo evento (antes de cancelar el antiguo,
      // para que si el webhook de cancelación llega ya no coincida con este external_id).
      const oldEventUuid = appt.calendly_event_uuid
      const { error: updErr } = await sb
        .from('appointments')
        .update({
          appointment_datetime: newDatetimeISO,
          duration_minutes: parsedDuration,
          external_id: result.eventUri,
          calendly_event_uuid: result.eventUuid,
          reschedule_url: result.rescheduleUrl,
          meeting_url: null, // se rellenará con el webhook invitee.created del nuevo evento
          status: 'scheduled',
          rescheduled_from_status: appt.status,
        })
        .eq('id', appointmentId)
        .eq('tenant_id', t.tenantId)
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

      await notifyCreatuagente('cita.reprogramada', appt.utm_content, {
        idExternoEvento: result.eventUuid || oldEventUuid,
        origen: 'calendly',
        inicio: toZonedISO(newDatetimeISO),
        fin: addMinutesISO(newDatetimeISO, parsedDuration),
        titulo: appt.calendar_name || 'Llamada',
      })

      // Cancela el evento antiguo en Calendly (ya migramos la fila al nuevo evento).
      // Con reintento y log VISIBLE: si esta cancelación falla en silencio, el evento viejo sigue
      // vivo en Calendly → doble reserva, recordatorios de la hora antigua y confusión que acaba
      // provocando reagendas que dejan la fila "huérfana". Por eso ya no la tragamos sin más.
      let calendlyCanceled = false
      if (process.env.CALENDLY_API_TOKEN && oldEventUuid) {
        // Backoff entre intentos: los fallos de Calendly aquí suelen ser transitorios
        // (rate limit / red), y sin espera los 3 intentos fallan casi siempre por la misma
        // razón. Esta cancelación es lo único que evita el duplicado en Google Calendar
        // del closer (Calendly sincroniza el evento nuevo al instante, el viejo solo
        // desaparece cuando esta llamada tiene éxito).
        for (let intento = 1; intento <= 3 && !calendlyCanceled; intento++) {
          if (intento > 1) await new Promise((r) => setTimeout(r, 1000 * intento))
          try {
            const r = await fetch(`https://api.calendly.com/scheduled_events/${oldEventUuid}/cancellation`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'Reprogramada desde la app' }),
            })
            calendlyCanceled = r.ok
            if (!r.ok) {
              const detail = await r.text().catch(() => '')
              console.error(`[reschedule] Calendly no canceló el evento antiguo ${oldEventUuid}: HTTP ${r.status} (intento ${intento}/3) ${detail}`)
            }
          } catch (e) {
            console.error(`[reschedule] Error de red cancelando evento Calendly ${oldEventUuid} (intento ${intento}/3):`, e)
          }
        }
        if (!calendlyCanceled) {
          console.error(`[reschedule] AVISO: el evento antiguo ${oldEventUuid} sigue vivo en Calendly tras la reprogramación de la cita ${appointmentId}. Revisar manualmente para evitar doble reserva.`)
          // Persistido (no solo logueado): el cron diario de recordatorios reintenta cancelar
          // estos eventos huérfanos para que un fallo transitorio de Calendly no deje un
          // duplicado permanente en Google Calendar sin que nadie se entere.
          await sb
            .from('appointments')
            .update({ calendly_cleanup_pending: true, calendly_cleanup_event_uuid: oldEventUuid })
            .eq('id', appointmentId)
            .eq('tenant_id', t.tenantId)
        }
      }

      await sb.from('audit_logs').insert({
        tenant_id: t.tenantId,
        actor_user_id: t.userId,
        entity_type: 'appointment',
        entity_id: appointmentId,
        action: 'reschedule',
        old_values: oldValues,
        new_values: { appointment_datetime: newDatetimeISO, duration_minutes: parsedDuration, calendlyCanceled },
      })

      // Historial de llamadas (best-effort): deja constancia de la reagenda en `activities` sin
      // que un fallo aquí tumbe la reprogramación, que ya se aplicó correctamente arriba.
      try {
        await sb.from('activities').insert({
          tenant_id: t.tenantId,
          contact_id: appt.contact_id,
          person_id: t.userId,
          type: 'llamada',
          direction: 'saliente',
          result: 'cita_agendada',
          notes: `Reagendada de ${formatDateTime(oldValues.appointment_datetime)} a ${formatDateTime(newDatetimeISO)}${priorStatusNote}`,
        })
      } catch (activityErr) {
        console.error('[reschedule] No se pudo registrar la actividad de reagenda:', activityErr)
      }

      return NextResponse.json({ ok: true, appointmentId, calendlyCanceled })
    }

    // Caso 2: agenda manual (no Calendly) → solo actualizar fecha/duración de la misma fila.
    const { error: updErr } = await sb
      .from('appointments')
      .update({
        appointment_datetime: newDatetimeISO,
        duration_minutes: parsedDuration,
        status: 'scheduled',
        rescheduled_from_status: appt.status,
      })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    if (appt.calendly_event_uuid) {
      await notifyCreatuagente('cita.reprogramada', appt.utm_content, {
        idExternoEvento: appt.calendly_event_uuid,
        origen: 'calendly',
        inicio: toZonedISO(newDatetimeISO),
        fin: addMinutesISO(newDatetimeISO, parsedDuration),
        titulo: appt.calendar_name || 'Llamada',
      })
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'appointment',
      entity_id: appointmentId,
      action: 'reschedule',
      old_values: oldValues,
      new_values: { appointment_datetime: newDatetimeISO, duration_minutes: parsedDuration },
    })

    // Historial de llamadas (best-effort): igual que en el path de Calendly, no debe tumbar la
    // reprogramación (que ya se aplicó arriba) si falla.
    try {
      await sb.from('activities').insert({
        tenant_id: t.tenantId,
        contact_id: appt.contact_id,
        person_id: t.userId,
        type: 'llamada',
        direction: 'saliente',
        result: 'cita_agendada',
        notes: `Reagendada de ${formatDateTime(oldValues.appointment_datetime)} a ${formatDateTime(newDatetimeISO)}${priorStatusNote}`,
      })
    } catch (activityErr) {
      console.error('[reschedule] No se pudo registrar la actividad de reagenda:', activityErr)
    }

    return NextResponse.json({ ok: true, appointmentId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
