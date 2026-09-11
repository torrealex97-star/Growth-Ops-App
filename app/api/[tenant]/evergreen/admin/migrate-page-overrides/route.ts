import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Añade users.page_overrides (visibilidad de páginas una a una). Idempotente.
// Acceso: sesión admin/director de esta subcuenta (o super_admin) O Authorization: Bearer <CRON_SECRET>.
// Es DDL global (ALTER TABLE ADD COLUMN IF NOT EXISTS), no hay datos tenant-scoped que filtrar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = req.headers.get('authorization')
  const viaCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!viaCron) {
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!t.isSuperAdmin && !['admin', 'director'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }
  try {
    const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
    await sql.unsafe(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS page_overrides TEXT[];`)
    // Regla de DESBLOQUEO del fijo: por nº de ventas o por facturación del mes (0 = sin condición).
    await sql.unsafe(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fijo_min_sales INT NOT NULL DEFAULT 0;`)
    await sql.unsafe(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fijo_unlock_type TEXT NOT NULL DEFAULT 'sales';`)
    await sql.unsafe(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fijo_min_revenue NUMERIC NOT NULL DEFAULT 0;`)
    // Biblioteca de llamadas: por defecto toda llamada con grabación es visible al equipo (opt-out).
    await sql.unsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS library_shared BOOLEAN NOT NULL DEFAULT TRUE;`)
    await sql.end()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
