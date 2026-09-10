-- v33 — Funnel DIARIO: clics de enlace y visitas a la página por día.
--   Amplía campaign_daily con las dos métricas que faltaban para poder construir el
--   "Resumen Diario de Métricas" pedido por el equipo de ads (CTR, CPC, % de carga,
--   coste por visita, tasa de registro… todo por FECHA). Se rellenan con el sync diario
--   (/api/evergreen/meta/daily-sync + cron meta-daily), que ya trae inline_link_clicks y
--   landing_page_view por día. Idempotente. Requiere public.campaign_daily (v32).
SET check_function_bodies = false;

ALTER TABLE public.campaign_daily ADD COLUMN IF NOT EXISTS link_clicks   BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.campaign_daily ADD COLUMN IF NOT EXISTS landing_views BIGINT NOT NULL DEFAULT 0;
