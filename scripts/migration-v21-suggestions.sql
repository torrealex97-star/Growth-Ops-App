-- v21 — Sugerencias y mejoras de la plataforma
--   · Cualquier usuario autenticado puede enviar una sugerencia, reporte de
--     error o comentario sobre la app desde el propio panel.
--   · El admin/director ve todas las sugerencias en un listado y gestiona su
--     estado (nueva → en revisión → planificada → en progreso → resuelta /
--     descartada) para ir mejorando y corrigiendo la plataforma.

CREATE TABLE IF NOT EXISTS public.suggestions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'mejora'
                CHECK (type IN ('mejora', 'error', 'comentario')),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'nueva'
                CHECK (status IN ('nueva', 'en_revision', 'planificada', 'en_progreso', 'resuelta', 'descartada')),
  admin_notes TEXT,
  page_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suggestions_status_idx  ON public.suggestions(status);
CREATE INDEX IF NOT EXISTS suggestions_user_idx    ON public.suggestions(user_id);
CREATE INDEX IF NOT EXISTS suggestions_created_idx ON public.suggestions(created_at DESC);

DROP TRIGGER IF EXISTS suggestions_updated_at ON public.suggestions;
CREATE TRIGGER suggestions_updated_at
  BEFORE UPDATE ON public.suggestions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado crea sugerencias a su nombre.
DROP POLICY IF EXISTS "suggestions_insert_self" ON public.suggestions;
CREATE POLICY "suggestions_insert_self" ON public.suggestions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- El autor ve las suyas; admin/director ven todas.
DROP POLICY IF EXISTS "suggestions_select" ON public.suggestions;
CREATE POLICY "suggestions_select" ON public.suggestions
  FOR SELECT USING (user_id = auth.uid() OR is_admin_or_director());

-- Solo admin/director gestionan estado y notas / eliminan.
DROP POLICY IF EXISTS "suggestions_update_admin" ON public.suggestions;
CREATE POLICY "suggestions_update_admin" ON public.suggestions
  FOR UPDATE USING (is_admin_or_director());

DROP POLICY IF EXISTS "suggestions_delete_admin" ON public.suggestions;
CREATE POLICY "suggestions_delete_admin" ON public.suggestions
  FOR DELETE USING (is_admin_or_director());
