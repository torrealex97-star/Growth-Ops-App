import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { notifyCreatuagente, EVENTO_BY_STATUS } from '@/lib/creatuagente'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']
// Campos que un closer/setter puede editar en SU agenda (notas + enlaces de la llamada).
const ALLOWED = ['notes', 'recording_url', 'transcript_drive_url', 'transcript'] as const

// Edita campos de una agenda (notas / enlaces de la llamada). Va por service role porque la RLS de
// appointments solo deja UPDATE a admin/director; aquí el closer/setter puede editar LO SUYO.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, patch } = await req.json()
    if (!appointmentId || !patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('data_scope, roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    const scope = (urow as { data_scope?: string } | null)?.data_scope || 'own'
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: appt } = await sb
      .from('appointments')
      .select('id, setter_id, closer_id, status, utm_content, calendly_event_uuid, calendar_name')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })
    // Liderazgo y quien tiene visibilidad de equipo (data_scope='team') pueden gestionar cualquier
    // agenda del equipo; el resto solo las suyas (donde es setter o closer). Coherente con la RLS de SELECT.
    if (!LEADERSHIP.includes(role) && scope !== 'team' && appt.setter_id !== t.userId && appt.closer_id !== t.userId) {
      return NextResponse.json({ error: 'Solo puedes gestionar tus propias agendas' }, { status: 403 })
    }

    const clean: Record<string, string | null | boolean> = {}
    for (const k of ALLOWED) {
      if (k in patch) {
        const v = patch[k]
        clean[k] = typeof v === 'string' && v.trim() ? v.trim() : null
      }
    }
    // Compartir/ocultar en la biblioteca de llamadas (boolean).
    if ('library_shared' in patch) clean.library_shared = !!patch.library_shared
    if (Object.keys(clean).length === 0) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })

    const { error } = await sb.from('appointments').update(clean).eq('id', appointmentId).eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Si el closer/setter deja notas de la reunión, se reenvían a creatuagente junto con el
    // evento que corresponda al estado actual de la cita (normalmente cita.completada, ya que
    // las notas se escriben después de la llamada). Si el estado actual no tiene evento mapeado
    // (p.ej. sigue "scheduled"), no hay nada que reenviar todavía.
    if (typeof clean.notes === 'string' && clean.notes && appt.calendly_event_uuid) {
      const evento = EVENTO_BY_STATUS[appt.status] ?? 'cita.completada'
      await notifyCreatuagente(await getTenantConfigWithFallback(t.tenantId), evento, appt.utm_content, {
        idExternoEvento: appt.calendly_event_uuid,
        origen: 'calendly',
        titulo: appt.calendar_name || 'Llamada',
        notas: clean.notes,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
