-- v44 — Testimonio en el pipeline editorial: cada pieza de contenido puede llevar
-- marcado qué caso de éxito usa, para que el editor sepa de dónde coger la foto, la
-- historia y el vídeo al montarla.
-- El guión generado con prueba social ya llega aquí con el testimonio puesto.
SET check_function_bodies = false;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS testimonio_id UUID REFERENCES public.testimonios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_items_testimonio_idx ON public.content_items (testimonio_id)
  WHERE testimonio_id IS NOT NULL;
