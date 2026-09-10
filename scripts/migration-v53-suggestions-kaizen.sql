-- v53 — Kaizen: reconocimiento y ranking de sugerencias del equipo
--   · Añade `resolved_at` a `suggestions` para poder medir "ideas implementadas
--     este mes" y construir un ranking/reconocimiento (mejora continua estilo
--     Kaizen) sin tocar ventas, pipeline ni métricas de negocio.
--   · Un trigger mantiene `resolved_at` automáticamente: se rellena la primera
--     vez que el status pasa a 'resuelta' y se limpia si se revierte el status
--     a cualquier otro valor (para que el ranking mensual sea siempre correcto).

ALTER TABLE public.suggestions
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Backfill: para las sugerencias que ya estaban 'resuelta' antes de esta
-- migración, usamos su updated_at como fecha de resolución aproximada.
UPDATE public.suggestions
   SET resolved_at = updated_at
 WHERE status = 'resuelta' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS suggestions_resolved_at_idx ON public.suggestions(resolved_at);

CREATE OR REPLACE FUNCTION public.suggestions_set_resolved_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'resuelta' AND (OLD.status IS DISTINCT FROM 'resuelta') THEN
    NEW.resolved_at := NOW();
  ELSIF NEW.status <> 'resuelta' AND OLD.status = 'resuelta' THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suggestions_resolved_at_trigger ON public.suggestions;
CREATE TRIGGER suggestions_resolved_at_trigger
  BEFORE UPDATE ON public.suggestions
  FOR EACH ROW EXECUTE FUNCTION public.suggestions_set_resolved_at();

-- Nota RLS: no se añade ninguna policy nueva. El ranking/estadísticas por
-- persona se sirven desde una API (/api/evergreen/suggestions/team-stats) que
-- usa la service role y devuelve solo agregados (nombre + contadores), nunca
-- el contenido de las sugerencias de otras personas, así que no hace falta
-- abrir el SELECT de la tabla a todo el equipo.
