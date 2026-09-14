import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { notifyCreatuagente } from '@/lib/creatuagente'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

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

    // Token de la subcuenta, no del entorno: cancelar con el token de Vercel (o con el de otra
    // subcuenta) no cancela nada y el evento se queda vivo en el calendario del closer.
    const calendlyToken = (await getTenantConfigWithFallback(t.tenantId)).CALENDLY_API_TOKEN
    let calendlyCanceled = false
    if (appt.external_source === 'calendly' && appt.calendly_event_uuid && calendlyToken) {
      const r = await fetch(`https://api.calendly.com/scheduled_events/${appt.calendly_event_uuid}/cancellation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${calendlyToken}`, 'Content-Type': 'application/json' },
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
