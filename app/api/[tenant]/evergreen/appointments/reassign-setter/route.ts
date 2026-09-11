import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']

// Reasigna el setter de una agenda existente. Solo liderazgo (admin/director/manager) puede
// hacerlo, ya que afecta a la atribución de comisiones. Va por service role porque appointments
// solo permite UPDATE a admin/director por RLS.
export async function POST(req: NextRequest) {
  try {
    const { appointmentId, setterId } = await req.json()
    if (!appointmentId) return NextResponse.json({ error: 'Falta la agenda' }, { status: 400 })

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!LEADERSHIP.includes(role)) {
      return NextResponse.json({ error: 'Solo liderazgo puede reasignar el setter' }, { status: 403 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: appt } = await sb.from('appointments').select('id').eq('id', appointmentId).single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    if (setterId) {
      const { data: setter } = await sb.from('users').select('id, roles(key)').eq('id', setterId).single()
      const setterRole = (setter?.roles as { key?: string } | null)?.key
      if (!setter || (setterRole !== 'setter' && setterRole !== 'admin')) {
        return NextResponse.json({ error: 'El usuario elegido no es un setter válido' }, { status: 400 })
      }
    }

    const { data, error } = await sb
      .from('appointments')
      .update({ setter_id: setterId || null })
      .eq('id', appointmentId)
      .select('id, setter_id, setter:setter_id(id, full_name)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, appointment: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
