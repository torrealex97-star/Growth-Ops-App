import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const VALID_TYPES = ['llamada', 'whatsapp', 'email', 'dm_instagram', 'sms']
const VALID_RESULTS = ['contactado', 'no_contesta', 'buzon', 'conversacion', 'cita_agendada']

// Historial de actividades (llamadas/whatsapp/etc) por contacto. Append-only, igual que
// payment_follow_ups: cualquier rol autenticado del CRM puede leer y añadir (la RLS de
// `activities` ya lo permite scoped por ownership/data_scope).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id: contactId } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const sb = serviceClient()
  const { data, error } = await sb
    .from('activities')
    .select('id, type, direction, result, duration_min, notes, created_at, users(full_name)')
    .eq('contact_id', contactId)
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const activities = (data || []).map((r) => ({
    id: r.id,
    type: r.type,
    direction: r.direction,
    result: r.result,
    duration_min: r.duration_min,
    notes: r.notes,
    created_at: r.created_at,
    author: (r.users as { full_name?: string } | null)?.full_name || 'Alguien',
  }))
  return NextResponse.json({ activities })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id: contactId } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const body = await req.json().catch(() => ({}))
  const { type, direction, result, duration_min, notes } = body as {
    type?: string
    direction?: string
    result?: string
    duration_min?: number
    notes?: string
  }

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Tipo de actividad inválido' }, { status: 400 })
  }
  if (result && !VALID_RESULTS.includes(result)) {
    return NextResponse.json({ error: 'Resultado inválido' }, { status: 400 })
  }

  const sb = serviceClient()
  const { data: contact } = await sb.from('contacts').select('id').eq('id', contactId).eq('tenant_id', t.tenantId).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 })

  const { data, error } = await sb
    .from('activities')
    .insert({
      tenant_id: t.tenantId,
      contact_id: contactId,
      person_id: t.userId,
      type,
      direction: direction || 'saliente',
      result: result || null,
      duration_min: typeof duration_min === 'number' ? duration_min : null,
      notes: notes?.trim() || null,
    })
    .select('id, type, direction, result, duration_min, notes, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, activity: data })
}
