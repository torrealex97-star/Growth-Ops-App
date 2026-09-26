import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// ── Detalle del email (§22): registro + timeline de eventos ─────────────────
// RLS + requireTenant garantizan que solo se vean emails de ESTA subcuenta.
// No se exponen secretos ni cuerpos completos: solo metadatos del envío.

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!t.administraTenant) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: msg } = await sb
    .from('email_messages')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (!msg) return NextResponse.json({ error: 'Email no encontrado' }, { status: 404 })

  const { data: events } = await sb
    .from('email_events')
    .select('event_type, event_timestamp, provider_event_id')
    .eq('email_message_id', id)
    .order('event_timestamp', { ascending: true })

  return NextResponse.json({ message: msg, events: events ?? [] })
}
