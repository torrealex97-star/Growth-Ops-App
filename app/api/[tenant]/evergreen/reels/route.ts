import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'editor']

async function requireRole() {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return { error: 'No autenticado', status: 401 as const }
  const { data: row } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
  const role = (row?.roles as { key?: string } | null)?.key
  if (!role || !ALLOWED_ROLES.includes(role)) return { error: 'No autorizado', status: 403 as const }
  return { user }
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET ?day=YYYY-MM-DD&status=pendiente|aprobado|descartado
// Por defecto: borradores de HOY (o los más recientes si hoy no tiene nada aún).
export async function GET(req: NextRequest) {
  const auth = await requireRole()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = svc()
  const day = req.nextUrl.searchParams.get('day')
  const status = req.nextUrl.searchParams.get('status')

  let query = sb.from('reel_drafts').select('*').order('created_at', { ascending: false })
  if (day) {
    query = query.eq('draft_day', day)
  } else {
    const today = new Date().toISOString().slice(0, 10)
    query = query.eq('draft_day', today)
  }
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Si no se pidió un día concreto y hoy no tiene nada, cae a los más recientes
  // (por si el cron aún no ha corrido hoy).
  if (!day && (!data || data.length === 0)) {
    let fallback = sb.from('reel_drafts').select('*').order('created_at', { ascending: false }).limit(20)
    if (status) fallback = fallback.eq('status', status)
    const { data: recent, error: recentErr } = await fallback
    if (recentErr) return NextResponse.json({ error: recentErr.message }, { status: 500 })
    return NextResponse.json({ drafts: recent || [] })
  }

  return NextResponse.json({ drafts: data || [] })
}
