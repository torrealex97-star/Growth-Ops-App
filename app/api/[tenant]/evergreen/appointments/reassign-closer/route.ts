import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']

// Reasigna el closer de una agenda existente. Solo liderazgo (admin/director/manager) puede
// hacerlo, ya que afecta a la atribución de comisiones. Va por service role porque appointments
// solo permite UPDATE a admin/director por RLS.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, closerId } = await req.json()
    if (!appointmentId) return NextResponse.json({ error: 'Falta la agenda' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!LEADERSHIP.includes(role)) {
      return NextResponse.json({ error: 'Solo liderazgo puede reasignar el closer' }, { status: 403 })
    }

    const { data: appt } = await sb.from('appointments').select('id').eq('id', appointmentId).eq('tenant_id', t.tenantId).single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    if (closerId) {
      const { data: closer } = await sb.from('users').select('id, roles(key)').eq('id', closerId).single()
      const closerRole = (closer?.roles as { key?: string } | null)?.key
      if (!closer || (closerRole !== 'closer' && closerRole !== 'admin')) {
        return NextResponse.json({ error: 'El usuario elegido no es un closer válido' }, { status: 400 })
      }
    }

    const { data, error } = await sb
      .from('appointments')
      .update({ closer_id: closerId || null })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .select('id, closer_id, closer:closer_id(id, full_name)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, appointment: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
