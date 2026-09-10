-- Espejo automático de reels propios de Instagram hacia YouTube (Shorts).
-- youtube_uploads: registro append-only de qué media de ig_media ya se intentó subir a YouTube,
-- para no duplicar subidas en cada pasada del cron.
CREATE TABLE IF NOT EXISTS public.youtube_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_media_external_id TEXT NOT NULL UNIQUE REFERENCES public.ig_media(external_id) ON DELETE CASCADE,
  youtube_video_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marca de arranque de la función: solo se auto-suben a YouTube los reels publicados DESPUÉS de
-- activar esta función (evita subir de una vez todo el histórico de reels ya publicados en IG).
INSERT INTO public.app_settings (key, value)
VALUES ('youtube_sync_started_at', to_jsonb(now()))
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.youtube_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS youtube_uploads_select ON public.youtube_uploads;
CREATE POLICY youtube_uploads_select ON public.youtube_uploads FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','editor'));
DROP POLICY IF EXISTS youtube_uploads_modify ON public.youtube_uploads;
CREATE POLICY youtube_uploads_modify ON public.youtube_uploads FOR ALL
  USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());
