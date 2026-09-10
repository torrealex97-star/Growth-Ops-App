-- v19 — Integración Meta Marketing API en `campaigns`.
-- Columnas para volcar automáticamente las campañas de Meta y comparar leads.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS provider TEXT;              -- 'meta' | null (manual)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS external_id TEXT;           -- id de la campaña en Meta
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS reach INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS meta_leads INTEGER NOT NULL DEFAULT 0;   -- leads que reporta Meta
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS funnel_leads INTEGER NOT NULL DEFAULT 0; -- leads reales en la app (cruce UTM)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;      -- última sincronización con Meta

-- Upsert idempotente por (provider, external_id): evita duplicar campañas de Meta.
-- OJO: índice NO parcial. Un índice parcial (WHERE ...) NO sirve para ON CONFLICT
-- sin repetir el predicado, y Supabase no lo genera. Los NULL se consideran
-- distintos, así que las campañas manuales (provider/external_id NULL) no colisionan.
DROP INDEX IF EXISTS public.campaigns_provider_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_provider_external_idx
  ON public.campaigns (provider, external_id);
