import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'

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
      const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
      const role = (urow?.roles as { key?: string } | null)?.key
      if (!['admin', 'director'].includes(role || '')) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
      }
      tenantId = t.tenantId
    } else {
      const { data: tenantRow } = await sb.from('tenants').select('id').eq('slug', tenant).maybeSingle()
      tenantId = tenantRow?.id ?? null
    }
    if (!tenantId) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })

    const { data: sales } = await sb.from('sales').select('id').eq('tenant_id', tenantId)
    const ids = (sales ?? []).map((s: { id: string }) => s.id)

    let created = 0
    let deleted = 0
    const perSale: { saleId: string; created: number; deleted: number }[] = []
    for (const id of ids) {
      const r = await reconcileSaleCommissions(sb, id)
      created += r.created
      deleted += r.deleted
      if (r.created || r.deleted) perSale.push({ saleId: id, created: r.created, deleted: r.deleted })
    }

    return NextResponse.json({ ok: true, sales: ids.length, created, deleted, perSale })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
