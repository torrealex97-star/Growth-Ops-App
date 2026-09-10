import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { syncSequraDelinquents } from '@/lib/sequra/syncDelinquents'

export const runtime = 'nodejs'
export const maxDuration = 300

// Sincroniza morosos reales de sequra (merchant iawinners) hacia sequra_delinquent_customers.
// Auth: header Bearer CRON_SECRET (Vercel Cron) o sesión de admin/director/cobros (botón manual).
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  try {
    const cookieStore = await cookies()
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return false
    const { data } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (data?.roles as { key?: string } | null)?.key
    return role === 'admin' || role === 'director' || role === 'cobros'
  } catch { return false }
}

async function handle(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const result = await syncSequraDelinquents()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
