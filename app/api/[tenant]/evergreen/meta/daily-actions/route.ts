import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { parseAccountIds } from '@/lib/meta/accounts'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['super_admin', 'admin', 'director', 'manager', 'marketing', 'adscripcion']

// Filas DIARIAS de Meta (campaign_daily) con las acciones normalizadas (meta_actions /
// meta_action_values). Es la materia prima del dashboard Meta Ads: cada fila es lo que Meta
// devolvió para una campaña un día, SIN agregar — así el frontend puede recalcular KPIs,
// funnel, tendencias y tablas para cualquier selección (cuenta/campaña/funnel/rango).
//
// NULL ≠ 0 (§7): meta_actions null = ese día Meta no devolvió actions[]; {} = array presente
// sin acciones de los tipos conocidos. El consumidor respeta esa diferencia.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')

    // Misma fuente de verdad que el resto de la app: solo cuentas activas en Integraciones.
    const cfg = await getTenantConfigWithFallback(t.tenantId)
    const activeAccountIds = parseAccountIds(cfg.META_AD_ACCOUNT_ID)

    const rows: Record<string, unknown>[] = []
    const PAGE = 1000
    let offset = 0
    for (let guard = 0; guard < 200; guard++) {
      // select('*') tolera bases sin las columnas nuevas (llegan undefined → null en el cliente).
      let q = sb.from('campaign_daily').select('*').eq('tenant_id', t.tenantId)
      if (activeAccountIds.length > 0) q = q.in('account_id', activeAccountIds)
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)
      const { data, error } = await q.range(offset, offset + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const page = (data ?? []) as Record<string, unknown>[]
      rows.push(...page)
      if (page.length < PAGE) break
      offset += PAGE
    }

    return NextResponse.json({ ok: true, rows, activeAccountIds })
  } catch (err) {
    console.error('[api/meta/daily-actions GET]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
