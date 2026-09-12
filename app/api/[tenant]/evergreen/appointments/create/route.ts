import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCloserEventType, createInvitee, CalendlyError } from '@/lib/calendly'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller']

// POST /api/${tenant}/evergreen/appointments/create
// Crea la cita en Calendly (cuenta madre) y la guarda en la app como
// external_source='calendly', dejando que el webhook invitee.created la
// actualice sin duplicar (reconcilia por external_id = URI del evento).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = (await req.json()) as {
      contactId?: string
      closerId?: string
      setterId?: string | null
      startTime?: string // ISO UTC
      durationMinutes?: number
      timezone?: string // timezone del contacto (ej: 'America/New_York')
      manual?: boolean // crea la agenda SOLO en la app (sin Calendly)
    }
    const { contactId, closerId, startTime, timezone } = body
    const setterId = body.setterId || null
    if (!contactId) return NextResponse.json({ error: 'Falta contacto' }, { status: 400 })
    if (!startTime) return NextResponse.json({ error: 'Falta la hora' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const role = t.role || ''
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const parsedDuration = body.durationMinutes && body.durationMinutes > 0 ? body.durationMinutes : 30

    // Modo manual: agenda solo en la plataforma (closer sin Calendly, o el usuario lo elige).
    // Va por service role para saltar la RLS de INSERT (que solo deja a admin/director), igual que
    // el resto de endpoints de agendas. Sin closer/Calendly no exigimos email del contacto.
    if (body.manual) {
      const { data: saved, error: insErr } = await sb
        .from('appointments')
        .insert({
          tenant_id: t.tenantId,
          contact_id: contactId,
          external_source: 'manual',
          source: 'manual',
          status: 'scheduled',
          appointment_datetime: new Date(startTime).toISOString(),
          duration_minutes: parsedDuration,
          closer_id: closerId || null,
          setter_id: setterId,
        })
        .select('id')
        .single()
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
      await sb.from('contacts').update({ lead_status: 'agendado' }).eq('id', contactId).eq('tenant_id', t.tenantId)
      return NextResponse.json({ ok: true, appointmentId: saved.id, manual: true })
    }

    if (!closerId) return NextResponse.json({ error: 'Falta closer' }, { status: 400 })

    const { data: contact } = await sb
      .from('contacts')
      .select('id, full_name, first_name, last_name, email, phone')
      .eq('id', contactId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!contact) return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 })
    if (!contact.email) {
      return NextResponse.json({ error: 'El contacto necesita un email para agendar en Calendly' }, { status: 400 })
    }

    const { data: closer } = await sb
      .from('users')
      .select('email, calendly_email, full_name')
      .eq('id', closerId)
      .maybeSingle()
    if (!closer?.email) return NextResponse.json({ error: 'El closer no tiene email' }, { status: 400 })

    let setterTrackingCode: string | null = null
    if (setterId) {
      const { data: setter } = await sb.from('users').select('tracking_code').eq('id', setterId).maybeSingle()
      setterTrackingCode = setter?.tracking_code || null
    }

    const et = await resolveCloserEventType(closer.calendly_email || closer.email)
    if (!et) {
      return NextResponse.json(
        { error: `${closer.full_name} no tiene un event type en la cuenta madre de Calendly` },
        { status: 400 }
      )
    }

    const result = await createInvitee({
      eventType: et,
      startTimeISO: new Date(startTime).toISOString(),
      invitee: {
        name: contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Sin nombre',
        email: contact.email,
        phone: contact.phone,
        timezone: timezone || 'Europe/Madrid',
      },
      utm: { utm_source: 'app', utm_term: setterTrackingCode },
    })

    // Guardar/actualizar la cita reconciliando por external_id (URI del evento).
    const apptFields = {
      tenant_id: t.tenantId,
      contact_id: contact.id,
      external_source: 'calendly',
      external_id: result.eventUri,
      calendly_event_uuid: result.eventUuid,
      source: 'calendly',
      status: 'scheduled',
      appointment_datetime: new Date(startTime).toISOString(),
      duration_minutes: body.durationMinutes && body.durationMinutes > 0 ? body.durationMinutes : et.duration || 30,
      calendar_name: et.name || 'Calendly',
      reschedule_url: result.rescheduleUrl,
      closer_id: closerId,
      ...(setterId ? { setter_id: setterId } : {}),
    }

    // Upsert por (tenant_id, external_id): si el webhook invitee.created llegó antes, actualiza
    // esa fila en vez de duplicarla (y viceversa). El UNIQUE es compuesto por tenant desde
    // 20260911200000_financial_integrity_constraints.sql — el onConflict debe apuntar a ambas.
    const { data: saved, error: aptErr } = await sb
      .from('appointments')
      .upsert(apptFields, { onConflict: 'tenant_id,external_id' })
      .select('id')
      .single()
    if (aptErr) {
      // La cita SÍ existe ya en Calendly; devolvemos aviso pero no es un fallo total.
      return NextResponse.json(
        {
          ok: true,
          calendlyCreated: true,
          dbSaved: false,
          warning: 'Creada en Calendly, pero no se pudo guardar en la app',
          detail: aptErr.message,
        },
        { status: 207 }
      )
    }
    const appointmentId = saved.id

    await sb.from('contacts').update({ lead_status: 'agendado' }).eq('id', contact.id).eq('tenant_id', t.tenantId)

    return NextResponse.json({ ok: true, appointmentId, eventUri: result.eventUri })
  } catch (err) {
    if (err instanceof CalendlyError) {
      // 409/400 típicos: el hueco ya no está disponible o datos inválidos.
      return NextResponse.json(
        { error: 'Calendly: ' + err.message, status: err.status, detail: err.body },
        { status: 502 }
      )
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
