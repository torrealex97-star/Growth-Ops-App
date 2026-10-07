import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error
    if (!['admin', 'director'].includes(auth.role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = (await req.json()) as {
      saleId?: unknown
      userId?: unknown
      targetPercent?: unknown
      reason?: unknown
    }
    const saleId = typeof body.saleId === 'string' ? body.saleId : ''
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const targetPercent = typeof body.targetPercent === 'number' ? body.targetPercent : Number.NaN
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

    if (!saleId || !userId || !Number.isFinite(targetPercent) || targetPercent < 0 || targetPercent > 100) {
      return NextResponse.json({ error: 'Venta, colaborador o porcentaje inválido' }, { status: 400 })
    }
    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json({ error: 'Indica un motivo de entre 3 y 500 caracteres' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data, error } = await sb.rpc('adjust_sale_collaborator_commission', {
      p_tenant_id: auth.tenantId,
      p_actor_user_id: auth.userId,
      p_sale_id: saleId,
      p_user_id: userId,
      p_target_percent: targetPercent,
      p_reason: reason,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
