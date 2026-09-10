import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']

// Marca/desmarca una agenda como "en seguimiento". Flag independiente del status (a diferencia
// del status 'seguimiento'), para poder marcarla sin perder si se presentó / fue no-show / etc.
// Mismo patrón de autorización que /appointments/status.
export async function POST(req: NextRequest) {
  try {
    const { appointmentId, needsFollowup } = await req.json()
    if (!appointmentId || typeof needsFollowup !== 'boolean') {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('data_scope, roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    const scope = (urow as { data_scope?: string } | null)?.data_scope || 'own'
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: appt } = await sb.from('appointments').select('id, setter_id, closer_id').eq('id', appointmentId).single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    if (!LEADERSHIP.includes(role) && scope !== 'team' && appt.setter_id !== user.id && appt.closer_id !== user.id) {
      return NextResponse.json({ error: 'Solo puedes gestionar tus propias agendas' }, { status: 403 })
    }

    const { error } = await sb.from('appointments').update({ needs_followup: needsFollowup }).eq('id', appointmentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
