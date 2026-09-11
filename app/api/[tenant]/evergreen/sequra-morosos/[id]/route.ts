import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const VALID_STATUSES = ['pendiente', 'contactado', 'recuperado', 'incobrable']

// Actualiza status/notes de un moroso sequra. Solo admin/director/cobros.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = await req.json()
    const { status, notes } = body as { status?: string; notes?: string }
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: row } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (row?.roles as { key?: string } | null)?.key
    if (!['admin', 'director', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const fields: Record<string, unknown> = {}
    if (status) fields.status = status
    if (notes !== undefined) fields.notes = notes
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const { error } = await sb
      .from('sequra_delinquent_customers')
      .update(fields)
      .eq('id', id)
      .eq('tenant_id', t.tenantId)
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
