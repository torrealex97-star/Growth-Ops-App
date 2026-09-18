import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Asignación MANUAL de funnel por campaña (Marketing › Campañas → dashboard Meta Ads).
// La sugerencia por nombre es solo sugerencia: esta tabla es la fuente de verdad y el usuario
// puede cambiar la asignación de una campaña en cualquier momento sin resincronizar.

const ALLOWED = ['dm', 'vsl', 'webinar', 'custom'] as const
type Asignacion = (typeof ALLOWED)[number]

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const sb = svc()
    const { data, error } = await sb
      .from('campaign_funnel_assignments')
      .select('campaign_id, funnel_type, custom_funnel_id, assigned_at')
      .eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const byCampaign: Record<string, { funnel_type: Asignacion; custom_funnel_id: string | null }> = {}
    for (const r of data ?? []) {
      byCampaign[String(r.campaign_id)] = {
        funnel_type: r.funnel_type as Asignacion,
        custom_funnel_id: (r.custom_funnel_id as string | null) ?? null,
      }
    }
    return NextResponse.json({ ok: true, byCampaign })
  } catch (err) {
    console.error('[api/meta/campaign-funnels GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!t.isSuperAdmin && !['admin', 'director', 'manager', 'marketing'].includes(t.role ?? ''))
      return NextResponse.json(
        { error: 'Solo admin/director/manager/marketing pueden asignar funnels' },
        { status: 403 }
      )
    const sb = svc()

    const body = (await req.json().catch(() => ({}))) as {
      campaign_id?: string
      funnel_type?: string
      custom_funnel_id?: string | null
    }
    const campaignId = body.campaign_id
    const funnel = body.funnel_type as Asignacion
    if (!campaignId || !ALLOWED.includes(funnel)) {
      return NextResponse.json(
        { error: 'campaign_id y funnel_type (dm|vsl|webinar|custom) son obligatorios' },
        { status: 400 }
      )
    }

    const { error } = await sb.from('campaign_funnel_assignments').upsert(
      {
        tenant_id: t.tenantId,
        campaign_id: campaignId,
        funnel_type: funnel,
        custom_funnel_id: body.custom_funnel_id ?? null,
        assigned_by: t.userId,
        assigned_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,campaign_id', ignoreDuplicates: false }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/meta/campaign-funnels PUT]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
