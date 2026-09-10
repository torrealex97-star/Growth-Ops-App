-- v23 — Instagram/Contenido: métricas de Facebook por reel (cross-post), análisis
-- de competencia (business_discovery), columnas de la vista tabla de Contenido,
-- y un kv genérico (app_settings) para el prompt de estilo de guiones.
-- Requiere helpers existentes: get_my_role(), is_admin_or_director(), handle_updated_at().
SET check_function_bodies = false;

-- ── Reels de la página de Facebook (cross-post del reel de IG) ────────────────
-- Se poblan desde /{page-id}/video_reels. Se emparejan con ig_media por
-- created_time (±minutos) + caption/description en la UI de detalle.
CREATE TABLE IF NOT EXISTS public.fb_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,               -- id del reel/vídeo en Facebook
  description TEXT,
  permalink TEXT,
  created_time TIMESTAMPTZ,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fb_media_external_idx ON public.fb_media (external_id);
CREATE INDEX IF NOT EXISTS fb_media_created_idx ON public.fb_media (created_time DESC);

-- ── Competidores de Instagram (perfiles públicos que vigilamos) ───────────────
CREATE TABLE IF NOT EXISTS public.ig_competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  followers_count INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_competitors_username_idx ON public.ig_competitors (lower(username));

-- ── Reels de competidores (via business_discovery: solo likes+comments) ───────
CREATE TABLE IF NOT EXISTS public.ig_competitor_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES public.ig_competitors(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  caption TEXT,
  media_type TEXT,
  media_product_type TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  engagement_proxy INTEGER NOT NULL DEFAULT 0,   -- likes + comments (no hay views de terceros)
  permalink TEXT,
  media_url TEXT,                                -- URL del vídeo (para transcribir/replicar)
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  transcript TEXT,
  ai_analysis JSONB,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_competitor_media_external_idx ON public.ig_competitor_media (external_id);
CREATE INDEX IF NOT EXISTS ig_competitor_media_comp_idx ON public.ig_competitor_media (competitor_id);
CREATE INDEX IF NOT EXISTS ig_competitor_media_eng_idx ON public.ig_competitor_media (engagement_proxy DESC);

-- ── Columnas nuevas de content_items para la vista tabla ──────────────────────
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS solution_explanation TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS solution_link TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS reference_reel_url TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS reference_transcript TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS our_reel_url TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS script TEXT;

-- ── Normalización de estados al nuevo flujo ───────────────────────────────────
-- idea | guionizado | grabado | editando | editado | publicado
UPDATE public.content_items SET status = 'editando' WHERE status = 'en_edicion';
UPDATE public.content_items SET status = 'editado'  WHERE status = 'revision';

-- ── app_settings: kv genérico (prompt de estilo, etc.) ────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (key, value)
VALUES ('ig_style_prompt', '{"prompt": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura para dirección/marketing/editor; escritura solo admin/director desde
-- la app (los sync van por service-role y saltan RLS).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fb_media','ig_competitors','ig_competitor_media']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (get_my_role() IN (''admin'',''director'',''manager'',''marketing'',''editor''))',
      t || '_select', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_modify', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (get_my_role() IN (''admin'',''director'',''marketing'')) WITH CHECK (get_my_role() IN (''admin'',''director'',''marketing''))',
      t || '_modify', t
    );
  END LOOP;
END $$;

-- app_settings: lectura marketing/dirección, escritura admin/director
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','editor'));
DROP POLICY IF EXISTS app_settings_modify ON public.app_settings;
CREATE POLICY app_settings_modify ON public.app_settings FOR ALL
  USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());
