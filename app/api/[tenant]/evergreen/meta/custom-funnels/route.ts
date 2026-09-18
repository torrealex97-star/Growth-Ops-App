import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Funnel PERSONALIZADO (§24): etapas elegidas por el usuario entre métricas y action types que
// Meta devuelve. Nunca se inventan etapas: el frontend solo ofrece las claves conocidas del
// normalizador (lib/meta/actions) y la tabla guarda exactamente esa elección.

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type StageInput = { metric: string; display_name?: string; is_primary?: boolean }

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const sb = svc()
    const { data, error } = await sb
      .from('meta_custom_funnels')
      .select('id, name, stages')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, funnels: data ?? [] })
  } catch (err) {
    console.error('[api/meta/custom-funnels GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!t.isSuperAdmin && !['admin', 'director', 'manager', 'marketing'].includes(t.role ?? ''))
      return NextResponse.json({ error: 'Sin permiso para crear funnels' }, { status: 403 })
    const sb = svc()

    const body = (await req.json().catch(() => ({}))) as { name?: string; stages?: StageInput[] }
    const name = (body.name ?? '').trim()
    const stages = Array.isArray(body.stages) ? body.stages.filter((s) => s && typeof s.metric === 'string') : []
    if (!name || stages.length === 0) {
      return NextResponse.json({ error: 'Nombre y al menos una etapa son obligatorios' }, { status: 400 })
    }
    const { data, error } = await sb
      .from('meta_custom_funnels')
      .insert({ tenant_id: t.tenantId, name, stages, created_by: t.userId })
      .select('id, name, stages')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, funnel: data })
  } catch (err) {
    console.error('[api/meta/custom-funnels POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
