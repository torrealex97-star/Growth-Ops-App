-- Métricas del vídeo ya publicado en YouTube (para poder mostrarlas en la app junto a las de IG)
-- y soporte de backfill controlado (máx N subidas/día) de reels antiguos ya publicados en Instagram.
ALTER TABLE public.youtube_uploads
  ADD COLUMN IF NOT EXISTS views BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_synced_at TIMESTAMPTZ;

-- Backfill: encola TODOS los reels propios ya existentes en ig_media que aún no se hayan
-- intentado subir a YouTube, para que el cron los vaya publicando a razón de unos pocos al día
-- (ver YOUTUBE_BACKFILL_DAILY_LIMIT). No se tocan los que ya estén en la tabla (subidos o fallidos).
INSERT INTO public.youtube_uploads (ig_media_external_id, status)
SELECT m.external_id, 'pending'
FROM public.ig_media m
WHERE m.media_product_type = 'REELS'
  AND m.media_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.youtube_uploads u WHERE u.ig_media_external_id = m.external_id)
ON CONFLICT (ig_media_external_id) DO NOTHING;
