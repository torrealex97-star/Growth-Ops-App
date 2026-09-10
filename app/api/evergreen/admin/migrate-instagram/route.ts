import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'
export const maxDuration = 60

// Aplica la migración v22 (tablas de Instagram orgánico). DDL idempotente.
// Auth: sesión admin/director O Bearer CRON_SECRET.
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

  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: 'Falta POSTGRES_URL' }, { status: 500 })

  try {
    const sql = postgres(process.env.POSTGRES_URL, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
    await sql.unsafe(`
      SET check_function_bodies = false;

      CREATE TABLE IF NOT EXISTS public.ig_media (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_id TEXT NOT NULL,
        media_type TEXT, media_product_type TEXT,
        caption TEXT, permalink TEXT, thumbnail_url TEXT, media_url TEXT,
        published_at TIMESTAMPTZ,
        reach INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
        shares INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0,
        total_interactions INTEGER NOT NULL DEFAULT 0, avg_watch_time NUMERIC NOT NULL DEFAULT 0,
        reach_followers INTEGER NOT NULL DEFAULT 0, reach_non_followers INTEGER NOT NULL DEFAULT 0,
        follows INTEGER NOT NULL DEFAULT 0, engagement_rate NUMERIC NOT NULL DEFAULT 0,
        transcript TEXT, transcript_status TEXT NOT NULL DEFAULT 'pendiente',
        ai_analysis JSONB, ai_analyzed_at TIMESTAMPTZ, synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ig_media_external_idx ON public.ig_media (external_id);
      CREATE INDEX IF NOT EXISTS ig_media_published_idx ON public.ig_media (published_at DESC);

      CREATE TABLE IF NOT EXISTS public.ig_account_daily (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_date DATE NOT NULL,
        followers_count INTEGER NOT NULL DEFAULT 0, media_count INTEGER NOT NULL DEFAULT 0,
        reach INTEGER NOT NULL DEFAULT 0, profile_views INTEGER NOT NULL DEFAULT 0,
        new_follows INTEGER NOT NULL DEFAULT 0, unfollows INTEGER NOT NULL DEFAULT 0,
        reach_followers INTEGER NOT NULL DEFAULT 0, reach_non_followers INTEGER NOT NULL DEFAULT 0,
        synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ig_account_daily_date_idx ON public.ig_account_daily (snapshot_date);

      CREATE TABLE IF NOT EXISTS public.ig_audience (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dimension TEXT NOT NULL, bucket TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ig_audience_dim_idx ON public.ig_audience (dimension, bucket);

      CREATE TABLE IF NOT EXISTS public.ig_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_id TEXT NOT NULL, media_external_id TEXT, username TEXT, text TEXT,
        like_count INTEGER NOT NULL DEFAULT 0, commented_at TIMESTAMPTZ,
        synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ig_comments_external_idx ON public.ig_comments (external_id);
      CREATE INDEX IF NOT EXISTS ig_comments_media_idx ON public.ig_comments (media_external_id);

      CREATE TABLE IF NOT EXISTS public.ig_conversations_daily (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_date DATE NOT NULL,
        total_conversations INTEGER NOT NULL DEFAULT 0, unread_conversations INTEGER NOT NULL DEFAULT 0,
        total_messages INTEGER NOT NULL DEFAULT 0, unique_people INTEGER NOT NULL DEFAULT 0,
        synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ig_conversations_daily_date_idx ON public.ig_conversations_daily (snapshot_date);

      DO $$
      DECLARE t TEXT;
      BEGIN
        FOREACH t IN ARRAY ARRAY['ig_media','ig_account_daily','ig_audience','ig_comments','ig_conversations_daily']
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
          EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (get_my_role() IN (''admin'',''director'',''manager'',''marketing'',''editor''))', t || '_select', t);
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_modify', t);
          EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director())', t || '_modify', t);
        END LOOP;
      END $$;
    `)
    await sql.end()
    return NextResponse.json({ ok: true, migrated: 'v22-instagram' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error aplicando la migración'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
