-- v27 — Multi-cuenta en Meta Ads.
-- Guarda la cuenta publicitaria (act_XXX) de origen en cada campaña, para poder
-- filtrar el panel por cuenta. El gasto total sigue siendo la suma de todas.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_id TEXT; -- cuenta publicitaria de Meta (act_XXX)

-- Índice para filtrar/agrupar campañas por cuenta de forma eficiente.
CREATE INDEX IF NOT EXISTS campaigns_account_id_idx
  ON public.campaigns (account_id);
