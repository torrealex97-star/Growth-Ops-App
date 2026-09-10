-- v39 — Alcance de contenido para editores.
-- El editor solo VE y solo EDITA las piezas donde figura como editor asignado.
-- Admin / director / marketing conservan acceso total.

DROP POLICY IF EXISTS content_select ON public.content_items;
CREATE POLICY content_select ON public.content_items FOR SELECT USING (
  get_my_role() IN ('admin','director','marketing')
  OR (get_my_role() = 'editor' AND assigned_to = auth.uid())
);

-- La edición amplia (INSERT/UPDATE/DELETE) sigue siendo de admin/director/marketing.
DROP POLICY IF EXISTS content_modify ON public.content_items;
CREATE POLICY content_modify ON public.content_items FOR ALL
  USING (get_my_role() IN ('admin','director','marketing'))
  WITH CHECK (get_my_role() IN ('admin','director','marketing'));

-- El editor solo puede actualizar SUS piezas y no puede reasignarlas a otro
-- (el WITH CHECK obliga a que sigan siendo suyas tras la actualización).
DROP POLICY IF EXISTS content_editor_update ON public.content_items;
CREATE POLICY content_editor_update ON public.content_items FOR UPDATE
  USING (get_my_role() = 'editor' AND assigned_to = auth.uid())
  WITH CHECK (get_my_role() = 'editor' AND assigned_to = auth.uid());
