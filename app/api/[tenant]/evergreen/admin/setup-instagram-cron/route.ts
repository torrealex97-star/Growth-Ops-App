import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_EXPR = '0 */6 * * *' // cada 6 h (pg_cron; Vercel Hobby solo permite diario)

// Programa en Supabase pg_cron una sincronización del Instagram orgánico cada 6 h
// vía pg_net con Bearer CRON_SECRET. Mismo patrón que setup-meta-cron.
// Auth: sesión admin/director de ESTA subcuenta (o super_admin) O Bearer CRON_SECRET.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const JOB_NAME = `instagram-sync-${tenant}` // pg_cron job names son globales en la BD, no por tenant
  const SYNC_URL = `${req.nextUrl.origin}/api/${tenant}/evergreen/cron/instagram`
  const auth = req.headers.get('authorization')
  const bearerOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

  if (!bearerOk) {
    // requireTenant primero: sin esto, un admin/director de OTRA subcuenta podría programar
    // (des)activar el cron de sincronización de esta subcuenta con solo conocer su slug.
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
    const { data: row } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (row?.roles as { key?: string } | null)?.key
    if (!t.isSuperAdmin && role !== 'admin' && role !== 'director') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }

  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: 'Falta POSTGRES_URL' }, { status: 500 })
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Falta CRON_SECRET' }, { status: 500 })

  const secret = process.env.CRON_SECRET.replace(/'/g, "''")
  const sql = postgres(process.env.POSTGRES_URL, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
  const report: Record<string, unknown> = {}

  try {
    try { await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_net;`); report.pg_net = 'ok' } catch (e) { report.pg_net = e instanceof Error ? e.message : 'error' }
    try { await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_cron;`); report.pg_cron = 'ok' } catch (e) { report.pg_cron = e instanceof Error ? e.message : 'error' }

    await sql.unsafe(`DO $$ BEGIN PERFORM cron.unschedule('${JOB_NAME}'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`)
    const command = `select net.http_get(url := '${SYNC_URL}', headers := '{"Authorization": "Bearer ${secret}"}'::jsonb);`
    await sql.unsafe(`select cron.schedule('${JOB_NAME}', '${CRON_EXPR}', $cmd$ ${command} $cmd$);`)
    const jobs = await sql.unsafe(`select jobname, schedule, active from cron.job where jobname = '${JOB_NAME}';`)
    report.job = jobs?.[0] ?? null
    await sql.end()

    if (!report.job) {
      return NextResponse.json({ error: 'No se pudo crear el job. Habilita pg_cron y pg_net en Supabase → Database → Extensions.', report }, { status: 500 })
    }
    return NextResponse.json({ ok: true, message: 'Cron de Instagram (cada 6 h) activado en Supabase', report })
  } catch (e) {
    await sql.end().catch(() => {})
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error configurando pg_cron', report }, { status: 500 })
  }
}
