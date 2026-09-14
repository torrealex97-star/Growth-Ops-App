import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions, recomputeRepCommissionTiers } from '@/lib/commissions/generate'

export const runtime = 'nodejs'
export const maxDuration = 60

// Reparación masiva: reconcilia las comisiones de TODAS las ventas (de esta subcuenta) a partir
// de sus cobros reales, para cuadrar la contabilidad (corrige cobros que no generaron comisión y
// tramos desalineados). Idempotente. Acceso: sesión admin/director O cabecera
// Authorization: Bearer <CRON_SECRET> (en ese caso reconcilia todos los tenants activos).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = req.headers.get('authorization')
    const viaCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    let tenantId: string | null = null
    if (!viaCron) {
      const t = await requireTenant(tenant)
      if ('error' in t) return t.error
      const role = t.role
      if (!['admin', 'director'].includes(role || '')) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
      }
      tenantId = t.tenantId
    } else {
      const { data: tenantRow } = await sb.from('tenants').select('id').eq('slug', tenant).maybeSingle()
      tenantId = tenantRow?.id ?? null
    }
    if (!tenantId) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })

    const { data: sales } = await sb.from('sales').select('id, setter_id, closer_id').eq('tenant_id', tenantId)
    const rows = sales ?? []
    const ids = rows.map((s) => s.id)

    let created = 0
    let deleted = 0
    const perSale: { saleId: string; created: number; deleted: number }[] = []
    // skipTierRecompute: en esta reparación masiva cada rep puede tener decenas de ventas, y
    // recomputeRepCommissionTiers ya es idempotente — recalcularlo aquí una vez por venta
    // (N veces por rep) es trabajo repetido. Se recalcula una sola vez al final, con el cash
    // ya consolidado de TODAS las ventas reconciliadas.
    for (const id of ids) {
      const r = await reconcileSaleCommissions(sb, tenantId, id, [], { skipTierRecompute: true })
      created += r.created
      deleted += r.deleted
      if (r.created || r.deleted) perSale.push({ saleId: id, created: r.created, deleted: r.deleted })
    }

    const affectedPairs = new Map<string, { repId: string; role: 'setter' | 'closer' }>()
    for (const s of rows) {
      if (s.setter_id) affectedPairs.set(`${s.setter_id}|setter`, { repId: s.setter_id, role: 'setter' })
      if (s.closer_id) affectedPairs.set(`${s.closer_id}|closer`, { repId: s.closer_id, role: 'closer' })
    }
    await recomputeRepCommissionTiers(sb, tenantId, Array.from(affectedPairs.values()))

    return NextResponse.json({ ok: true, sales: ids.length, created, deleted, perSale })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
