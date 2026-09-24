-- ANOTACIONES SOBRE GRÁFICOS.
--
-- Un pico o un valle en una serie temporal no se explica solo mirando el número: hace falta saber
-- qué pasó ese día (una campaña que arrancó, un cambio de precio, una caída del webhook). Esta tabla
-- guarda esas notas puestas por el equipo, ancladas a una fecha, para que los gráficos (TrendChart y
-- similares) puedan marcarlas con una `ReferenceLine` en vez de dejar que cada pico quede sin
-- explicación.
--
-- Es del EQUIPO de la subcuenta, no de la plataforma: cualquier miembro puede anotar y leer las
-- de su tenant (como ai_business_facts), y solo admin/director puede corregir o borrar una nota
-- ajena — quien la escribió también puede borrar la suya.
CREATE TABLE public.annotations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id),
  date         DATE NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  -- Categoría libre (no vocabulario cerrado): "marketing", "producto", "operación"... La UI sugiere
  -- las más usadas pero no impone una lista, igual que canonical_events.event_name.
  category     TEXT,
  created_by   UUID NOT NULL REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El acceso a un gráfico casi siempre pide "las anotaciones de este tenant en este rango de fechas".
CREATE INDEX annotations_tenant_date_idx ON public.annotations(tenant_id, date DESC);

ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "annotations_select_team" ON public.annotations FOR SELECT
  USING (get_my_role() IS NOT NULL);
CREATE POLICY "annotations_insert_team" ON public.annotations FOR INSERT
  WITH CHECK (get_my_role() IS NOT NULL AND created_by = auth.uid());
-- Autor o admin/director pueden corregir/borrar; nadie más.
CREATE POLICY "annotations_update_own_or_admin" ON public.annotations FOR UPDATE
  USING (created_by = auth.uid() OR is_admin_or_director());
CREATE POLICY "annotations_delete_own_or_admin" ON public.annotations FOR DELETE
  USING (created_by = auth.uid() OR is_admin_or_director());

CREATE POLICY "annotations_tenant_isolation" ON public.annotations AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

COMMENT ON TABLE public.annotations IS
  'Notas del equipo ancladas a una fecha, para marcar en los gráficos (TrendChart) qué pasó ese día.';
