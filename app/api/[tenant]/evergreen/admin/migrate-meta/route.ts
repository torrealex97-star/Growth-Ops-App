import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'
export const maxDuration = 60

// Aplica la migración v19 (columnas de Meta en `campaigns`).
// Auth: sesión admin/director O Bearer CRON_SECRET. DDL idempotente.
export async function POST(req: NextRequest) {
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
    if (role !== 'admin' && role !== 'director') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: 'Falta POSTGRES_URL' }, { status: 500 })
  }

  try {
    const sql = postgres(process.env.POSTGRES_URL, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
    await sql.unsafe(`
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS provider TEXT;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS external_id TEXT;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS reach INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS meta_leads INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS funnel_leads INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
      -- v28 — métricas de funnel de ads (Meta ampliado + cruce CRM)
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS link_clicks BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS landing_views BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS appointments_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS shows_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS sales_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS sales_revenue NUMERIC NOT NULL DEFAULT 0;
      -- índice NO parcial (el parcial rompe ON CONFLICT); NULLs no colisionan
      DROP INDEX IF EXISTS public.campaigns_provider_external_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS campaigns_provider_external_idx
        ON public.campaigns (provider, external_id);
      -- v33 — funnel diario: clics de enlace y visitas a la página por día
      ALTER TABLE public.campaign_daily ADD COLUMN IF NOT EXISTS link_clicks   BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE public.campaign_daily ADD COLUMN IF NOT EXISTS landing_views BIGINT NOT NULL DEFAULT 0;
    `)
    await sql.end()
    return NextResponse.json({ ok: true, migrated: 'v19-meta + v28-ads-funnel + v33-daily-funnel' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error aplicando la migración'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
