import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runInstagramSync } from '@/lib/instagram/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']

// Sincroniza el Instagram orgánico (@adrian.martinez.s) hacia ig_media / ig_account_daily / ig_audience.
// Auth: sesión (admin/director/manager/marketing) O Bearer CRON_SECRET.
async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const bearerOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

  if (!bearerOk) {
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: row } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (row?.roles as { key?: string } | null)?.key
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const result = await runInstagramSync(sb)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Instagram'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}
