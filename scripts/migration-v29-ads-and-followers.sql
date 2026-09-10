-- v29 — Nivel ANUNCIO (drill-down campaña → anuncios) + métrica de SEGUIDORES.
-- · campaigns.followers: seguidores atribuidos por Meta a la campaña (action_type
--   de tipo follow). 0 en campañas que no son de captación de seguidores.
-- · campaign_ads: un registro por anuncio de Meta, con su gasto/leads/seguidores,
--   enlazado a su campaña. Permite ver y filtrar el rendimiento por anuncio.

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS followers INTEGER; -- follows atribuidos (lifetime)

CREATE TABLE IF NOT EXISTS public.campaign_ads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id          TEXT UNIQUE NOT NULL,           -- ad id de Meta
  campaign_external_id TEXT,                            -- campaign id de Meta
  campaign_id          UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  account_id           TEXT,                            -- act_XXX
  account_name         TEXT,                            -- nombre legible de la cuenta
  name                 TEXT NOT NULL,
  adset_name           TEXT,
  status               TEXT,                            -- activa / pausada / finalizada
  spend                NUMERIC DEFAULT 0,
  impressions          BIGINT DEFAULT 0,
  clicks               BIGINT DEFAULT 0,
  reach                BIGINT DEFAULT 0,
  link_clicks          BIGINT DEFAULT 0,
  landing_views        BIGINT DEFAULT 0,
  leads                INTEGER DEFAULT 0,
  followers            INTEGER DEFAULT 0,               -- follows atribuidos al anuncio
  synced_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_ads_campaign_id_idx  ON public.campaign_ads (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_ads_account_id_idx    ON public.campaign_ads (account_id);
CREATE INDEX IF NOT EXISTS campaign_ads_campaign_ext_idx  ON public.campaign_ads (campaign_external_id);

-- RLS idéntica a campaigns (lectura para roles con acceso; escritura solo admin/director/marketing).
ALTER TABLE public.campaign_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_ads_select ON public.campaign_ads;
CREATE POLICY campaign_ads_select ON public.campaign_ads FOR SELECT
  USING (get_my_role() = ANY (ARRAY['admin','director','manager','marketing','adscripcion']));

DROP POLICY IF EXISTS campaign_ads_modify ON public.campaign_ads;
CREATE POLICY campaign_ads_modify ON public.campaign_ads FOR ALL
  USING (get_my_role() = ANY (ARRAY['admin','director','marketing']))
  WITH CHECK (get_my_role() = ANY (ARRAY['admin','director','marketing']));
