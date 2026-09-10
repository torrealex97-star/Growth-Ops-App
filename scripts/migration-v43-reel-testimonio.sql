-- v43 — Vincula un testimonio a cada borrador de reel, para que el editor sepa qué caso
-- de éxito lleva ese reel y pueda coger su foto, su historia y el vídeo original al montarlo.
-- ON DELETE SET NULL: si se borra un testimonio, el reel se queda sin él pero no se pierde.
SET check_function_bodies = false;

ALTER TABLE public.reel_drafts
  ADD COLUMN IF NOT EXISTS testimonio_id UUID REFERENCES public.testimonios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reel_drafts_testimonio_idx ON public.reel_drafts (testimonio_id)
  WHERE testimonio_id IS NOT NULL;
