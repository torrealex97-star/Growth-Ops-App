import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Webhook ENTRANTE de GHL para el tracking de ONBOARDING del alumno. Tres eventos:
//   - event=click     → el alumno abrió la landing de accesos (trigger link de GHL).
//                       Marca contracts.accesos_abiertos_at en su contrato de alumno.
//   - event=booked    → el alumno AGENDÓ su sesión de onboarding (calendario de GHL).
//                       Marca sales.onboarding_scheduled_at (+ onboarding_session_at) →
//                       estado "Onboarding agendado" en el pipeline de alumnos.
//   - event=completed → la sesión de onboarding SE REALIZÓ (trigger de GHL al finalizar la
//                       llamada/marcar el evento como completado). Marca sales.onboarding_date
//                       automáticamente — antes solo se podía marcar a mano desde Alumnos.
//                       Configura en GHL un workflow que llame a esta URL con ?event=completed
//                       cuando el evento de calendario de onboarding pase a "Show"/completado.
//
// Auth: header 'x-ghl-secret' o query '?secret=' == ONBOARDING_INBOUND_SECRET (fail-closed).
// Identificación del alumno: ghl_contact_id → email → teléfono.

const pick = <T,>(...vals: (T | undefined | null)[]) =>
  vals.find((v) => v !== undefined && v !== null && v !== '') ?? null

async function resolveContact(
  sb: SupabaseClient,
  ids: { ghlContactId: string | null; email: string | null; phone: string | null }
): Promise<{ id: string } | null> {
  if (ids.ghlContactId) {
    const { data } = await sb.from('contacts').select('id').eq('ghl_contact_id', ids.ghlContactId).maybeSingle()
    if (data) return data
  }
  if (ids.email) {
    const { data } = await sb.from('contacts').select('id').eq('email', ids.email).maybeSingle()
    if (data) return data
  }
  if (ids.phone) {
    const { data } = await sb.from('contacts').select('id').eq('phone', ids.phone).maybeSingle()
    if (data) return data
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-ghl-secret') || req.nextUrl.searchParams.get('secret')
    if (!process.env.ONBOARDING_INBOUND_SECRET || secret !== process.env.ONBOARDING_INBOUND_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>
    // GHL puede anidar en contact/customData: aplanamos al raíz.
    const empty = (v: unknown) => v === undefined || v === null || v === ''
    const fill = (obj: unknown) => {
      if (obj && typeof obj === 'object')
        for (const [k, v] of Object.entries(obj as Record<string, unknown>))
          if (empty(payload[k])) payload[k] = v
    }
    fill(payload.contact); fill(payload.appointment); fill(payload.customData); fill(payload.custom_data)

    const event = (req.nextUrl.searchParams.get('event') || (payload.event as string) || '').toLowerCase()
    const email = (pick(payload.email) as string | null)?.toLowerCase?.().trim() || null
    const phone = (pick(payload.phone) as string | null)?.trim() || null
    const ghlContactId = pick(
      payload.contactId, payload.contact_id, payload.ghlContactId, payload.ghl_contact_id, payload.id
    ) as string | null

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const now = new Date().toISOString()

    const contact = await resolveContact(sb, { ghlContactId, email, phone })
    if (!contact) {
      return NextResponse.json({ error: 'Alumno no encontrado por ghl_contact_id/email/teléfono' }, { status: 404 })
    }

    // --- event=click : abrió la landing de accesos ---
    if (event === 'click' || event === 'onboarding.clicked' || event === 'accesos.abiertos') {
      // Contrato de alumno (venta completa, no reserva, no tomador) más reciente.
      const { data: c } = await sb
        .from('contracts')
        .select('id, accesos_abiertos_at')
        .eq('contact_id', contact.id)
        .eq('kind', 'venta')
        .neq('contract_party', 'tomador')
        .eq('is_reservation', false)
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (!c) return NextResponse.json({ error: 'Sin contrato de alumno para este contacto' }, { status: 404 })
      // Idempotente: solo grabamos el PRIMER click (no lo pisamos en cada visita).
      if (!c.accesos_abiertos_at) {
        await sb.from('contracts').update({ accesos_abiertos_at: now }).eq('id', c.id)
        await sb.from('audit_logs').insert({
          entity_type: 'contract', entity_id: c.id, action: 'update',
          new_values: { accesos_abiertos_at: now, via: 'ghl_onboarding_click' },
        })
      }
      return NextResponse.json({ ok: true, event: 'click', contractId: c.id, contactId: contact.id })
    }

    // --- event=booked : agendó su sesión de onboarding ---
    if (event === 'booked' || event === 'onboarding.booked' || event === 'onboarding.scheduled') {
      const sessionRaw = pick(
        payload.startTime, payload.start_time, payload.appointmentDate, payload.appointment_date, payload.selectedSlot
      ) as string | null
      let sessionAt: string | null = null
      if (sessionRaw) {
        const d = new Date(sessionRaw)
        if (!Number.isNaN(d.getTime())) sessionAt = d.toISOString()
      }
      // Venta más reciente del alumno.
      const { data: sale } = await sb
        .from('sales')
        .select('id')
        .eq('contact_id', contact.id)
        .order('sale_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!sale) return NextResponse.json({ error: 'Sin venta para este contacto' }, { status: 404 })
      const patch: Record<string, unknown> = { onboarding_scheduled_at: now }
      if (sessionAt) patch.onboarding_session_at = sessionAt
      const { error } = await sb.from('sales').update(patch).eq('id', sale.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await sb.from('audit_logs').insert({
        entity_type: 'sale', entity_id: sale.id, action: 'update',
        new_values: { ...patch, via: 'ghl_onboarding_booked' },
      })
      return NextResponse.json({ ok: true, event: 'booked', saleId: sale.id, contactId: contact.id, sessionAt })
    }

    // --- event=completed : la sesión de onboarding se realizó ---
    if (event === 'completed' || event === 'onboarding.completed' || event === 'onboarding.done') {
      const completedRaw = pick(payload.completedAt, payload.completed_at, payload.startTime, payload.start_time) as string | null
      let completedAt = now
      if (completedRaw) {
        const d = new Date(completedRaw)
        if (!Number.isNaN(d.getTime())) completedAt = d.toISOString()
      }
      const { data: sale } = await sb
        .from('sales')
        .select('id, onboarding_date')
        .eq('contact_id', contact.id)
        .order('sale_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!sale) return NextResponse.json({ error: 'Sin venta para este contacto' }, { status: 404 })
      // Idempotente: si ya se marcó (a mano o por este mismo webhook), no lo pisamos.
      if (!sale.onboarding_date) {
        const { error } = await sb.from('sales').update({ onboarding_date: completedAt.slice(0, 10) }).eq('id', sale.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await sb.from('audit_logs').insert({
          entity_type: 'sale', entity_id: sale.id, action: 'update',
          new_values: { onboarding_date: completedAt.slice(0, 10), via: 'ghl_onboarding_completed' },
        })
      }
      return NextResponse.json({ ok: true, event: 'completed', saleId: sale.id, contactId: contact.id })
    }

    return NextResponse.json({ error: `Evento no reconocido: "${event}". Usa ?event=click, ?event=booked o ?event=completed` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error', detail: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
