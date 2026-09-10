-- v60 — Permite a los editores crear piezas de contenido nuevas.
-- Bug: la política content_modify (v39) solo permitía INSERT/UPDATE/DELETE a
-- admin/director/marketing, así que cuando un editor pulsaba "nueva pieza" en
-- /evergreen/content, Supabase rechazaba el insert por RLS y la fila nunca
-- llegaba a la tabla (sin error visible más allá de un toast).
-- El editor solo puede crearse piezas A SÍ MISMO asignadas (mismo criterio que
-- ya usa content_editor_update para editar), para no darle vía libre a asignar
-- piezas a otras personas.

DROP POLICY IF EXISTS content_editor_insert ON public.content_items;
CREATE POLICY content_editor_insert ON public.content_items FOR INSERT
  WITH CHECK (get_my_role() = 'editor' AND assigned_to = auth.uid());
