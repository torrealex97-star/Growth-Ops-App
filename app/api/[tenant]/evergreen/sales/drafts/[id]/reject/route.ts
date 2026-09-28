import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// RECHAZA una venta borrador: el pago no corresponde a ninguna venta (o ya se registró por otra vía
// y el admin lo descarta a mano). No toca `sales` ni `collections`.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireFinanceAdmin(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return { error: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }) }
  }
  return session
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id: draftId } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const body = (await req.json().catch(() => ({}))) as { reason?: string }

  const sb = serviceClient()
  const { data, error } = await sb
    .from('sale_drafts')
    .update({
      status: 'rejected',
      reason: body.reason?.trim() || 'Rechazado sin motivo especificado',
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', draftId)
    .eq('tenant_id', session.tenantId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json({ error: 'Borrador no encontrado o ya resuelto' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
