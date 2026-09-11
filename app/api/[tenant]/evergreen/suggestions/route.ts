import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const VALID_TYPES = ['mejora', 'error', 'comentario']

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getRole(sb: ReturnType<typeof serviceClient>, userId: string) {
  const { data } = await sb
    .from('users')
    .select('id, roles(key)')
    .eq('id', userId)
    .single()
  return (data?.roles as { key?: string } | null)?.key ?? null
}

// GET — admin/director ven todas; el resto ve solo las suyas.
// Con ?mine=1 cualquiera (también admin) ve SOLO las suyas (para el tablón "Mis sugerencias").
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = serviceClient()
    const role = await getRole(sb, t.userId)
    let q = sb
      .from('suggestions')
      .select('*, users(full_name, email)')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false })

    const mineOnly = req.nextUrl.searchParams.get('mine') === '1'
    const isAdmin = role === 'admin' || role === 'director'
    if (!isAdmin || mineOnly) q = q.eq('user_id', t.userId)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ suggestions: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// POST — cualquier usuario autenticado envía una sugerencia.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = await req.json()
    const type = VALID_TYPES.includes(body.type) ? body.type : 'mejora'
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const page_url = typeof body.page_url === 'string' ? body.page_url.slice(0, 500) : null

    if (!title || !message) {
      return NextResponse.json({ error: 'El título y el mensaje son obligatorios' }, { status: 400 })
    }

    const sb = serviceClient()
    const { data, error } = await sb
      .from('suggestions')
      .insert({ user_id: t.userId, tenant_id: t.tenantId, type, title: title.slice(0, 200), message, page_url })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ suggestion: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
