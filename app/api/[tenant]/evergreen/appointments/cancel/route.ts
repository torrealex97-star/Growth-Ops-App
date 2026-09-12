import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { notifyCreatuagente } from '@/lib/creatuagente'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Cancela una agenda desde la app. Si es de Calendly, también la cancela en Calendly (API)
// para que quede cancelada en las dos. Roles: admin/director/manager/closer/setter.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, reason } = await req.json()
    if (!appointmentId) return NextResponse.json({ error: 'Falta appointmentId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director', 'manager', 'closer', 'setter'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: appt } = await sb
      .from('appointments')
      .select('id, external_source, calendly_event_uuid, utm_content, calendar_name')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    let calendlyCanceled = false
    if (appt.external_source === 'calendly' && appt.calendly_event_uuid && process.env.CALENDLY_API_TOKEN) {
      const r = await fetch(`https://api.calendly.com/scheduled_events/${appt.calendly_event_uuid}/cancellation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Cancelada desde la app' }),
      })
      calendlyCanceled = r.ok
    }

    await sb
      .from('appointments')
      .update({ status: 'cancelled_admin' })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
    if (appt.calendly_event_uuid) {
      await notifyCreatuagente('cita.cancelada', appt.utm_content, {
        idExternoEvento: appt.calendly_event_uuid,
        origen: 'calendly',
        titulo: appt.calendar_name || 'Llamada',
      })
    }
    return NextResponse.json({ ok: true, calendlyCanceled })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
