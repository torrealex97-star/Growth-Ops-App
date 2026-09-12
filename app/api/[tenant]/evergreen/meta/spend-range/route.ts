import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'adscripcion']

// Agrega el gasto DIARIO (campaign_daily) por campaña dentro de un rango [from, to].
// Devuelve un mapa campaignId → { spend, impressions, clicks, leads } para que la página de
// Campañas muestre el gasto REAL del periodo (este mes / trimestre / año), no el total histórico.
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

    // Paginación defensiva por si hay muchas filas (campañas × días). Se reconstruye la query
    // en cada página (los builders de supabase-js no se reutilizan tras await).
    // Nota: además del gasto, agregamos alcance, clics en el enlace y visitas a la página
    // (reach / link_clicks / landing_views) para que TODAS las métricas del embudo respondan al
    // filtro de periodo, no solo la inversión. Estas columnas existen en campaign_daily (v33).
    type RangeAgg = {
      spend: number
      impressions: number
      clicks: number
      leads: number
      reach: number
      link_clicks: number
      landing_views: number
    }
    const byCampaign: Record<string, RangeAgg> = {}
    const PAGE = 1000
    let offset = 0
    for (let guard = 0; guard < 200; guard++) {
      // select('*') para tolerar bases sin las columnas nuevas hasta que se aplique la migración.
      let q = sb.from('campaign_daily').select('*').eq('tenant_id', t.tenantId)
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)
      const { data, error } = await q.range(offset, offset + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const rows = (data ?? []) as Array<Record<string, unknown>>
      for (const r of rows) {
        const cid = String(r.campaign_id ?? '')
        if (!cid) continue
        const acc = byCampaign[cid] || {
          spend: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
          reach: 0,
          link_clicks: 0,
          landing_views: 0,
        }
        acc.spend += Number(r.spend) || 0
        acc.impressions += Number(r.impressions) || 0
        acc.clicks += Number(r.clicks) || 0
        acc.leads += Number(r.leads) || 0
        acc.reach += Number(r.reach) || 0
        acc.link_clicks += Number(r.link_clicks) || 0
        acc.landing_views += Number(r.landing_views) || 0
        byCampaign[cid] = acc
      }
      if (rows.length < PAGE) break
      offset += PAGE
    }

    return NextResponse.json({ ok: true, byCampaign })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
