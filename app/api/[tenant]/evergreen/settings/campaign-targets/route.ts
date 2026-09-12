import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Objetivos de ROAS/CAC/CPL (Campañas → alertas). Una fila por tenant; ausencia de fila = sin
// objetivos configurados (la UI no pinta alertas, no asume ningún valor por defecto).
function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const sb = svc()
  const { data, error } = await sb
    .from('campaign_targets')
    .select('target_roas,target_cac,target_cpl')
    .eq('tenant_id', t.tenantId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    target_roas: data?.target_roas ?? null,
    target_cac: data?.target_cac ?? null,
    target_cpl: data?.target_cpl ?? null,
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!t.isSuperAdmin && !['admin', 'director'].includes(t.role ?? ''))
    return NextResponse.json({ error: 'Solo admin/director pueden fijar objetivos' }, { status: 403 })
  const sb = svc()

  const body = (await req.json().catch(() => ({}))) as {
    target_roas?: number | null
    target_cac?: number | null
    target_cpl?: number | null
  }
  const toNumOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

  const { error } = await sb.from('campaign_targets').upsert(
    {
      tenant_id: t.tenantId,
      target_roas: toNumOrNull(body.target_roas),
      target_cac: toNumOrNull(body.target_cac),
      target_cpl: toNumOrNull(body.target_cpl),
      updated_by: t.userId,
    },
    { onConflict: 'tenant_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
