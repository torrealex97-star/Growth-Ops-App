-- v22 — Instagram orgánico (@adrian.martinez.s).
-- Vuelca los reels/posts con sus métricas, el crecimiento diario de la cuenta,
-- la demografía de la audiencia, los comentarios y las conversaciones (DMs).
-- Poblado por lib/instagram/sync.ts (endpoints /api/evergreen/instagram/sync y
-- /api/evergreen/cron/instagram). El sync usa service-role, así que RLS solo
-- afecta a la lectura desde la app (marketing/dirección).
-- Requiere helpers existentes: get_my_role(), is_admin_or_director(), handle_updated_at().
SET check_function_bodies = false;

-- ── Reels / posts con sus métricas de rendimiento ────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,                       -- id del media en Instagram
  media_type TEXT,                                 -- VIDEO / IMAGE / CAROUSEL_ALBUM
  media_product_type TEXT,                         -- REELS / FEED / STORY
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  media_url TEXT,                                  -- URL del vídeo (para transcribir)
  published_at TIMESTAMPTZ,
  reach INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,                -- reproducciones (métrica actual de reels)
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  total_interactions INTEGER NOT NULL DEFAULT 0,
  avg_watch_time NUMERIC NOT NULL DEFAULT 0,       -- ms (ig_reels_avg_watch_time)
  reach_followers INTEGER NOT NULL DEFAULT 0,      -- reach de seguidores
  reach_non_followers INTEGER NOT NULL DEFAULT 0,  -- reach de NO seguidores = descubrimiento
  follows INTEGER NOT NULL DEFAULT 0,              -- seguidores que generó este reel (si disponible)
  engagement_rate NUMERIC NOT NULL DEFAULT 0,      -- total_interactions / reach
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pendiente', -- pendiente/procesando/listo/error/no_aplica
  ai_analysis JSONB,                               -- {hook, estructura, tema, por_que_funciona, tags[]}
  ai_analyzed_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_media_external_idx ON public.ig_media (external_id);
CREATE INDEX IF NOT EXISTS ig_media_published_idx ON public.ig_media (published_at DESC);

-- ── Snapshot diario de la cuenta (crecimiento) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_account_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  followers_count INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  profile_views INTEGER NOT NULL DEFAULT 0,
  new_follows INTEGER NOT NULL DEFAULT 0,          -- follows del día (si follows_and_unfollows disponible)
  unfollows INTEGER NOT NULL DEFAULT 0,
  reach_followers INTEGER NOT NULL DEFAULT 0,
  reach_non_followers INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_account_daily_date_idx ON public.ig_account_daily (snapshot_date);

-- ── Demografía de la audiencia (último snapshot por dimensión+bucket) ─────────
CREATE TABLE IF NOT EXISTS public.ig_audience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension TEXT NOT NULL,                         -- country / city / age / gender
  bucket TEXT NOT NULL,                            -- ES / Madrid / 25-34 / F ...
  value INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_audience_dim_idx ON public.ig_audience (dimension, bucket);

-- ── Comentarios (fase 2b — mina de ideas / sentimiento) ──────────────────────
CREATE TABLE IF NOT EXISTS public.ig_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  media_external_id TEXT,
  username TEXT,
  text TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  commented_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_comments_external_idx ON public.ig_comments (external_id);
CREATE INDEX IF NOT EXISTS ig_comments_media_idx ON public.ig_comments (media_external_id);

-- ── Conversaciones / DMs — snapshot diario (fase 3) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_conversations_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  total_conversations INTEGER NOT NULL DEFAULT 0,
  unread_conversations INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  unique_people INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_conversations_daily_date_idx ON public.ig_conversations_daily (snapshot_date);

-- ── RLS: lectura para dirección/marketing/editor; escritura solo service-role ─
-- (el sync usa service-role y salta RLS; la app lee con la sesión del usuario)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ig_media','ig_account_daily','ig_audience','ig_comments','ig_conversations_daily']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (get_my_role() IN (''admin'',''director'',''manager'',''marketing'',''editor''))',
      t || '_select', t
    );
    -- INSERT/UPDATE/DELETE solo admin/director desde la app (el sync va por service-role).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_modify', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director())',
      t || '_modify', t
    );
  END LOOP;
END $$;
