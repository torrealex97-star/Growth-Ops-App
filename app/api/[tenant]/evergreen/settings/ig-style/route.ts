import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { readStylePrompt, readBusinessContext } from '@/lib/app-settings'

export const runtime = 'nodejs'

// Claves permitidas para editar desde este endpoint.
const KEYS = ['ig_style_prompt', 'ig_business_context'] as const
type Key = typeof KEYS[number]
const keyFrom = (v: string | null): Key => (KEYS.includes(v as Key) ? (v as Key) : 'ig_style_prompt')

async function getRole() {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return { role: null, user: null }
  const { data: row } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
  return { role: (row?.roles as { key?: string } | null)?.key ?? null, user }
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const { role } = await getRole()
  if (!role) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!['admin', 'director', 'manager', 'marketing', 'editor'].includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const key = keyFrom(req.nextUrl.searchParams.get('key'))
  const prompt = key === 'ig_business_context' ? await readBusinessContext() : await readStylePrompt()
  return NextResponse.json({ key, prompt })
}

export async function PUT(req: NextRequest) {
  const { role } = await getRole()
  if (!role) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!['admin', 'director'].includes(role)) return NextResponse.json({ error: 'Solo admin/director' }, { status: 403 })
  const body = await req.json()
  const key = keyFrom(body?.key ?? null)
  const { error } = await svc()
    .from('app_settings')
    .upsert({ key, value: { prompt: String(body?.prompt ?? '') }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
