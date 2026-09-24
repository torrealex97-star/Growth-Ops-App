import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

/**
 * Cambia estados de comisiones en lote sin permitir saltos de estado ni cruzar tenants.
 * pending -> approved y approved -> liquidated son las únicas transiciones válidas.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!['admin', 'director'].includes(t.role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = (await req.json()) as { action?: unknown; ids?: unknown }
    const action = body.action
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    if (action !== 'approve' && action !== 'liquidate') {
      return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
    }
    if (ids.length === 0 || ids.length > 500 || new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'Selecciona entre 1 y 500 comisiones únicas' }, { status: 400 })
    }

    const fromStatus = action === 'approve' ? 'pending' : 'approved'
    const toStatus = action === 'approve' ? 'approved' : 'liquidated'
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: candidates, error: readError } = await sb
      .from('commissions')
      .select('id, status, direction, user_id, liquidation_month')
      .eq('tenant_id', t.tenantId)
      .in('id', ids)
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

    const eligible = (candidates ?? []).filter((c) => c.status === fromStatus && c.direction === 'positive')
    if (eligible.length !== ids.length) {
      return NextResponse.json(
        {
          error: `Solo se pueden ${action === 'approve' ? 'aprobar pendientes' : 'liquidar aprobadas'} positivas; revisa la selección.`,
          eligible: eligible.length,
        },
        { status: 409 }
      )
    }

    const update: { status: string; approved_by?: string; updated_at: string } = {
      status: toStatus,
      updated_at: new Date().toISOString(),
    }
    if (action === 'approve') update.approved_by = t.userId

    const { data: updated, error: updateError } = await sb
      .from('commissions')
      .update(update)
      .eq('tenant_id', t.tenantId)
      .eq('status', fromStatus)
      .in('id', ids)
      .select('id')
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    if ((updated ?? []).length !== ids.length) {
      return NextResponse.json(
        { error: 'La selección cambió mientras se procesaba; no se completó el lote.' },
        { status: 409 }
      )
    }

    const { error: auditError } = await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'commission_batch',
      entity_id: ids[0],
      action: action === 'approve' ? 'approve_batch' : 'liquidate_batch',
      old_values: { status: fromStatus, ids },
      new_values: { status: toStatus, count: ids.length },
    })
    if (auditError) {
      return NextResponse.json(
        { error: 'El lote se aplicó, pero no se pudo guardar su auditoría', auditError: auditError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, action, count: ids.length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
