import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readStylePrompt, readBusinessContext } from '@/lib/app-settings'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Claves permitidas para editar desde este endpoint.
const KEYS = ['ig_style_prompt', 'ig_business_context'] as const
type Key = typeof KEYS[number]
const keyFrom = (v: string | null): Key => (KEYS.includes(v as Key) ? (v as Key) : 'ig_style_prompt')

async function getRole(sb: ReturnType<typeof svc>, userId: string) {
  const { data: row } = await sb.from('users').select('roles(key)').eq('id', userId).single()
  return (row?.roles as { key?: string } | null)?.key ?? null
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// NOTA: readStylePrompt()/readBusinessContext() (lib/app-settings.ts) leen `app_settings`
// por `key` global, sin filtrar por tenant_id — ese helper es compartido por otras rutas
// fuera de este lote y no se ha tocado aquí. app_settings.key tampoco tiene un UNIQUE
// per-tenant todavía, así que el valor sigue siendo efectivamente global entre tenants
// hasta que se actualice ese helper (fuera del alcance de este lote).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const sb = svc()
  const role = await getRole(sb, t.userId)
  if (!role) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!['admin', 'director', 'manager', 'marketing', 'editor'].includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const key = keyFrom(req.nextUrl.searchParams.get('key'))
  const prompt = key === 'ig_business_context' ? await readBusinessContext() : await readStylePrompt()
  return NextResponse.json({ key, prompt })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const sb = svc()
  const role = await getRole(sb, t.userId)
  if (!role) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!['admin', 'director'].includes(role)) return NextResponse.json({ error: 'Solo admin/director' }, { status: 403 })
  const body = await req.json()
  const key = keyFrom(body?.key ?? null)
  const { error } = await sb
    .from('app_settings')
    .upsert({ key, tenant_id: t.tenantId, value: { prompt: String(body?.prompt ?? '') }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
