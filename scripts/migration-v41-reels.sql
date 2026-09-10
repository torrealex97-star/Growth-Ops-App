-- v41 — "Reels del día": bandeja diaria (~5) de borradores de reel minados de las
-- cuentas de competencia ya vigiladas (ig_competitor_media), con guión adaptado
-- (hook + CTA [tenant]), transcripción original, enlace al vídeo original y una
-- idea corta de carrusel/flyer. Los escribe el cron (service-role); la app solo lee
-- y actualiza estado vía endpoints service-role.
-- Requiere helpers existentes: get_my_role().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.reel_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_media_id UUID,                    -- ig_competitor_media.id (único para deduplicar)
  source_permalink TEXT,
  source_account TEXT,
  thumbnail_url TEXT,
  caption TEXT,
  transcript TEXT,
  adapted_script TEXT,
  carousel_idea TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobado', 'descartado')),
  gen_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  draft_day DATE NOT NULL DEFAULT current_date,
  created_by UUID REFERENCES public.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS reel_drafts_source_media_idx ON public.reel_drafts (source_media_id) WHERE source_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reel_drafts_day_idx ON public.reel_drafts (draft_day DESC);
CREATE INDEX IF NOT EXISTS reel_drafts_status_idx ON public.reel_drafts (status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura para dirección/marketing/editor (mismo criterio que ig_competitor_media).
-- Las escrituras van siempre por endpoints con service-role, que saltan RLS: no
-- hace falta política de escritura para 'authenticated'.
ALTER TABLE public.reel_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reel_drafts_select ON public.reel_drafts;
CREATE POLICY reel_drafts_select ON public.reel_drafts FOR SELECT
  USING (get_my_role() IN ('admin', 'director', 'manager', 'marketing', 'editor'));
