-- v62 — Positivo del día/semana: nota de energía personal, con opción de compartirla
-- en el muro del equipo. Privada por defecto; el usuario decide si la hace visible.
--   · period_key: 'YYYY-MM-DD' para diarias, 'YYYY-Www' (ISO week) para semanales.
--   · una fila por usuario+periodo (upsert): al reescribir la nota del mismo día/semana
--     se actualiza en vez de duplicar.

CREATE TABLE IF NOT EXISTS public.positive_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly')),
  period_key  TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_shared   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS positive_notes_wall_idx
  ON public.positive_notes (is_shared, created_at DESC)
  WHERE is_shared = true;

CREATE OR REPLACE FUNCTION public.positive_notes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS positive_notes_updated_at_trigger ON public.positive_notes;
CREATE TRIGGER positive_notes_updated_at_trigger
  BEFORE UPDATE ON public.positive_notes
  FOR EACH ROW EXECUTE FUNCTION public.positive_notes_set_updated_at();

-- Nota RLS: igual que `suggestions`, no se abre policy nueva — todo el acceso pasa por
-- /api/evergreen/positive-notes con la service role, que filtra: cada uno solo ve/edita
-- su propia nota, y el muro del equipo solo expone las marcadas is_shared = true.
