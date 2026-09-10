-- v32 — Gasto DIARIO por campaña de Meta (serie temporal).
--   Permite filtrar el gasto por rango real (este mes, este trimestre, año…) en vez de mostrar
--   siempre el total histórico. Cada fila = (campaña, día) con gasto/impresiones/clics/leads.
--   Se rellena con el sync diario (/api/evergreen/meta/daily-sync + cron meta-daily).
--   Idempotente. Requiere public.campaigns.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.campaign_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  external_id  TEXT,                       -- id de campaña de Meta
  account_id   TEXT,                       -- cuenta publicitaria (act_XXX)
  date         DATE NOT NULL,
  spend        NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions  BIGINT NOT NULL DEFAULT 0,
  clicks       BIGINT NOT NULL DEFAULT 0,
  leads        INTEGER NOT NULL DEFAULT 0,
  reach        BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS campaign_daily_date_idx ON public.campaign_daily(date);
CREATE INDEX IF NOT EXISTS campaign_daily_campaign_idx ON public.campaign_daily(campaign_id);

-- RLS: cualquier miembro del equipo LEE; las escrituras van por service-role (bypass RLS).
ALTER TABLE public.campaign_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_daily_select ON public.campaign_daily;
CREATE POLICY campaign_daily_select ON public.campaign_daily
  FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS campaign_daily_modify ON public.campaign_daily;
CREATE POLICY campaign_daily_modify ON public.campaign_daily
  FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());
