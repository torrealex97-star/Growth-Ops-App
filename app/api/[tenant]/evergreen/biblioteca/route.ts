import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']
const ALLOWED = ['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller']

// Biblioteca de llamadas: devuelve las llamadas (agendas con grabación) COMPARTIDAS con el equipo.
// Va por service role porque la RLS de appointments acota a cada rep sus propias agendas, pero la
// biblioteca es material de entrenamiento cruzado. Liderazgo ve además las ocultas.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role || ''
    if (!ALLOWED.includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    const lead = LEADERSHIP.includes(role)

    const base =
      'id, appointment_datetime, recording_url, transcript_drive_url, ai_summary, ai_call_score, status, contacts(full_name), closer:closer_id(id, full_name)'

    // Intento con library_shared; si la columna aún no existe, reintento sin ella (todo compartido).
    let q = sb
      .from('appointments')
      .select(`${base}, library_shared`)
      .eq('tenant_id', t.tenantId)
      .not('recording_url', 'is', null)
      .order('appointment_datetime', { ascending: false })
      .limit(300)
    if (!lead) q = q.eq('library_shared', true)
    let { data, error } = await q
    if (error) {
      const r = await sb
        .from('appointments')
        .select(base)
        .eq('tenant_id', t.tenantId)
        .not('recording_url', 'is', null)
        .order('appointment_datetime', { ascending: false })
        .limit(300)
      data = (r.data ?? []).map((a) => ({ ...a, library_shared: true })) as typeof data
    }
    return NextResponse.json({ ok: true, calls: data ?? [], leadership: lead })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
