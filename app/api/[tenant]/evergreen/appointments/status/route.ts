import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { notifyCreatuagente, EVENTO_BY_STATUS } from '@/lib/creatuagente'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const VALID = ['scheduled', 'confirmed', 'show', 'no_show', 'cancelled', 'rescheduled', 'completed', 'cancelled_admin', 'cancelled_lead', 'seguimiento', 'reserva']
const LEADERSHIP = ['admin', 'director', 'manager']

// Cambia el estado de una agenda (marcar asistencia: se presentó / no show / confirmada, etc.).
// Va por service role porque appointments solo permite UPDATE a admin/director por RLS, pero un
// closer/setter puede gestionar LO SUYO. Autorización: liderazgo, o ser el setter/closer de la agenda.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, status } = await req.json()
    if (!appointmentId || !status) return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    if (!VALID.includes(status)) return NextResponse.json({ error: 'Estado no válido' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('data_scope, roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    const scope = (urow as { data_scope?: string } | null)?.data_scope || 'own'
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: appt } = await sb.from('appointments').select('id, setter_id, closer_id, utm_content, calendly_event_uuid, calendar_name').eq('id', appointmentId).eq('tenant_id', t.tenantId).single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    // Liderazgo y quien tiene visibilidad de equipo (data_scope='team') pueden gestionar cualquier
    // agenda del equipo; el resto solo las suyas (donde es setter o closer). Coherente con la RLS de SELECT.
    if (!LEADERSHIP.includes(role) && scope !== 'team' && appt.setter_id !== t.userId && appt.closer_id !== t.userId) {
      return NextResponse.json({ error: 'Solo puedes gestionar tus propias agendas' }, { status: 403 })
    }

    const { error } = await sb.from('appointments').update({ status }).eq('id', appointmentId).eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const evento = EVENTO_BY_STATUS[status]
    if (evento && appt.calendly_event_uuid) {
      await notifyCreatuagente(evento, appt.utm_content, {
        idExternoEvento: appt.calendly_event_uuid, origen: 'calendly', titulo: appt.calendar_name || 'Llamada',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
