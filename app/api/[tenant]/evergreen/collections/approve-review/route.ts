import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { generateCommissionsForCollection } from '@/lib/commissions/generate'
import type { Collection, Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// Aprueba manualmente un cobro que quedó en revisión (cuota 2+ de un plan personalizado):
// lo marca elegible y genera sus comisiones reales. Solo admin/director/cobros, igual que
// payments/mark (el equipo de cobros es quien controla este pipeline).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { collectionId } = await req.json()
    if (!collectionId) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: coll, error: collErr } = await sb
      .from('collections')
      .select('*')
      .eq('id', collectionId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (collErr || !coll) return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 })
    if (!coll.needs_commission_review) {
      return NextResponse.json({ error: 'Este cobro no está en revisión' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: updated } = await sb
      .from('collections')
      .update({ is_eligible_for_commission: true, eligible_at: now, needs_commission_review: false })
      .eq('id', collectionId)
      .select()
      .single()

    const { data: sale } = await sb
      .from('sales')
      .select('id, setter_id, closer_id, affiliate_id, affiliate_commission_percent')
      .eq('id', coll.sale_id)
      .eq('tenant_id', t.tenantId)
      .single()

    let commissionsGenerated = 0
    if (updated && sale) {
      commissionsGenerated = await generateCommissionsForCollection(sb, updated as Collection, sale as Sale)
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'collection',
      entity_id: collectionId,
      action: 'approve_commission_review',
      old_values: { needs_commission_review: true, is_eligible_for_commission: false },
      new_values: { needs_commission_review: false, is_eligible_for_commission: true },
    })

    return NextResponse.json({ ok: true, commissionsGenerated })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
