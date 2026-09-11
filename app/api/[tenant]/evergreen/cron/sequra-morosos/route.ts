import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { syncSequraDelinquents } from '@/lib/sequra/syncDelinquents'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 300

// Sincroniza morosos reales de sequra hacia sequra_delinquent_customers.
// Auth: header Bearer CRON_SECRET (Vercel Cron) o sesión de admin/director/cobros (botón manual).
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): syncSequraDelinquents
// ahora exige tenantId — estampa/filtra tenant_id en sequra_delinquent_customers, que es NOT NULL
// en esa tabla. Vercel Cron pega a una única URL estática, así que el disparo por CRON_SECRET
// recorre TODAS las subcuentas activas y corre la sync una vez por cada una (mismo patrón que
// cron/monthly); el botón manual sigue acotado a la subcuenta de la URL.
async function isCronAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization')
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
}

async function isSessionAuthorized(): Promise<boolean> {
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

async function handle(req: NextRequest, tenantSlug: string) {
  if (await isCronAuthorized(req)) {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
      if (tenantsErr) throw new Error(tenantsErr.message)
      const perTenant: Record<string, unknown> = {}
      for (const tn of tenants || []) {
        perTenant[tn.slug] = await syncSequraDelinquents(tn.id)
      }
      return NextResponse.json({ ok: true, tenants: perTenant })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  }

  if (!(await isSessionAuthorized())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return t.error
  try {
    const result = await syncSequraDelinquents(t.tenantId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  return handle(req, tenant)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  return handle(req, tenant)
}
