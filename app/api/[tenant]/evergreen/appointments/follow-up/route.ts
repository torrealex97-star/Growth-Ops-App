import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']

// Marca/desmarca una agenda como "en seguimiento". Flag independiente del status (a diferencia
// del status 'seguimiento'), para poder marcarla sin perder si se presentó / fue no-show / etc.
// Mismo patrón de autorización que /appointments/status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, needsFollowup } = await req.json()
    if (!appointmentId || typeof needsFollowup !== 'boolean') {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('data_scope, roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    const scope = (urow as { data_scope?: string } | null)?.data_scope || 'own'
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: appt } = await sb.from('appointments').select('id, setter_id, closer_id').eq('id', appointmentId).eq('tenant_id', t.tenantId).single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    if (!LEADERSHIP.includes(role) && scope !== 'team' && appt.setter_id !== t.userId && appt.closer_id !== t.userId) {
      return NextResponse.json({ error: 'Solo puedes gestionar tus propias agendas' }, { status: 403 })
    }

    const { error } = await sb.from('appointments').update({ needs_followup: needsFollowup }).eq('id', appointmentId).eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
