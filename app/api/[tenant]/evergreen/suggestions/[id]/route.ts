import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const VALID_STATUS = ['nueva', 'en_revision', 'planificada', 'en_progreso', 'resuelta', 'descartada']

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireAdmin(tenantSlug: string) {
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return { error: 'No autenticado', status: 401 as const }
  const sb = serviceClient()
  const role = t.role
  if (role !== 'admin' && role !== 'director') return { error: 'Sin permisos', status: 403 as const }
  return { ok: true as const, tenantId: t.tenantId }
}

// PATCH — admin/director gestiona estado y notas internas.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const guard = await requireAdmin(tenant)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json()
    const update: Record<string, unknown> = {}
    if (typeof body.status === 'string' && VALID_STATUS.includes(body.status)) update.status = body.status
    if (typeof body.admin_notes === 'string') update.admin_notes = body.admin_notes

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const sb = serviceClient()
    const { data, error } = await sb
      .from('suggestions')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', guard.tenantId)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ suggestion: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// DELETE — admin/director elimina una sugerencia.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const guard = await requireAdmin(tenant)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const sb = serviceClient()
    const { error } = await sb.from('suggestions').delete().eq('id', id).eq('tenant_id', guard.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
