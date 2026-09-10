-- v20 — Enlace de registro por campaña de afiliados
--   · Cada campaña tiene un `registration_slug`: token del enlace público que el admin comparte.
--   · Al abrir el enlace y registrarse:
--       - si el email YA es usuario → solo se le asigna la campaña (affiliate_campaign_members)
--       - si NO existe → se crea la cuenta de afiliado (alta automática) y se le asigna a la campaña
--   · Reutiliza el formulario público existente (/evergreen/afiliados/registro) añadiendo ?c=<slug>.

ALTER TABLE public.affiliate_campaigns
  ADD COLUMN IF NOT EXISTS registration_slug TEXT;

-- Backfill: genera un slug corto y único para las campañas ya existentes.
UPDATE public.affiliate_campaigns
SET registration_slug = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
WHERE registration_slug IS NULL;

-- Único (permite múltiples NULL en Postgres, pero la app siempre lo rellena al crear).
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_campaigns_reg_slug_idx
  ON public.affiliate_campaigns(registration_slug);
