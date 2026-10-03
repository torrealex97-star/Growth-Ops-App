-- SEGURIDAD P0 — hallazgo F01 del audit de dashboards (DASHBOARD_AUDIT.md), confirmado en
-- producción con una transacción de solo lectura (SET LOCAL ROLE authenticated + claims de un
-- afiliado real, ROLLBACK): un colaborador/afiliado con `data_scope='team'` veía TODAS las
-- ventas y citas del tenant (36 ventas / 636 citas), no solo las suyas (21 / 192 atribuidas) —
-- la cláusula `my_data_scope() = 'team'` de las políticas SELECT es un bypass total que no
-- distingue rol: cualquiera con ese valor en `public.users.data_scope` salta por completo el
-- resto de la política (setter_id/closer_id/is_my_collaborator_*).
--
-- `data_scope='team'` es un ajuste legítimo que un admin puede dar desde Ajustes → Usuarios
-- (`app/[tenant]/settings/users/page.tsx`), pensado para roles de liderazgo con "lectura amplia"
-- (admin/director/manager — mismo conjunto que `LEADERSHIP` en `lib/auth/permissions.ts`). El
-- bug es que hoy el valor del campo decide por sí solo, sin mirar el rol: en producción había 3
-- `affiliate` y 2 `closer`/`setter` con `data_scope='team'`, viendo el tenant entero.
--
-- Fix: una función que exige data_scope='team' Y rol de liderazgo; se usa en las 6 políticas que
-- comparten el mismo patrón `my_data_scope() = 'team'` (localizadas con
-- `pg_policies where qual ilike '%my_data_scope%'`). admin/director ya pasan por
-- `is_admin_or_director()` en la misma cláusula OR, así que no pierden nada; hoy no existe
-- ningún usuario con rol 'manager' en producción, así que no hay regresión posible ahí tampoco.
--
-- Verificado con dry-run (BEGIN…ROLLBACK, nunca aplicado hasta esta migración): el afiliado de
-- prueba pasó de ver 36 ventas/636 citas a exactamente 21/192 — las mismas que
-- is_my_collaborator_sale()/is_my_collaborator_row() ya le atribuían. Cero falsos negativos ni
-- positivos en esa comprobación. Confirmación explícita del usuario antes de aplicar (regla de
-- CLAUDE.md para migraciones de producción).
--
-- stripe_payments_select_team queda FUERA de esta migración a propósito: esa tabla no tiene
-- columna de atribución individual (ni setter_id/closer_id ni vínculo a collaborator_profiles),
-- y el dashboard de closer/setter (app/[tenant]/dashboard/page.tsx, cliente con RLS real) la lee
-- directamente sin pasar por un rol de liderazgo. Restringirla aquí a solo liderazgo rompería esa
-- pantalla para cualquier closer/setter normal sin ofrecerles un camino de datos sustituto; es un
-- hueco real pero necesita decisión de producto aparte (dar a stripe_payments una columna de
-- atribución, o mover esa lectura a una API acotada), no un ALTER POLICY de una línea.

CREATE OR REPLACE FUNCTION public.is_team_scope_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND u.data_scope = 'team'
      AND r.key IN ('admin', 'director', 'manager')
  );
$$;

REVOKE ALL ON FUNCTION public.is_team_scope_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_team_scope_allowed() TO authenticated;

ALTER POLICY sales_select_scope ON public.sales
  USING (is_admin_or_director() OR is_team_scope_allowed() OR (setter_id = auth.uid()) OR (closer_id = auth.uid()) OR is_my_collaborator_sale(id));

ALTER POLICY appointments_select_scope ON public.appointments
  USING (is_admin_or_director() OR is_team_scope_allowed() OR (setter_id = auth.uid()) OR (closer_id = auth.uid()) OR is_my_collaborator_row(contact_id));

ALTER POLICY activities_select ON public.activities
  USING (is_admin_or_director() OR is_team_scope_allowed() OR (person_id = auth.uid()));

ALTER POLICY collections_select_scope ON public.collections
  USING (is_admin_or_director() OR is_team_scope_allowed() OR (EXISTS ( SELECT 1 FROM sales s WHERE (s.id = collections.sale_id) AND ((s.setter_id = auth.uid()) OR (s.closer_id = auth.uid())))) OR is_my_collaborator_sale(sale_id));

ALTER POLICY contact_attributions_select_scope ON public.contact_attributions
  USING (is_admin_or_director() OR is_team_scope_allowed() OR (EXISTS ( SELECT 1 FROM appointments a WHERE (a.contact_id = contact_attributions.contact_id) AND ((a.setter_id = auth.uid()) OR (a.closer_id = auth.uid())))) OR (EXISTS ( SELECT 1 FROM sales s WHERE (s.contact_id = contact_attributions.contact_id) AND ((s.setter_id = auth.uid()) OR (s.closer_id = auth.uid())))) OR is_my_collaborator_row(contact_id));

ALTER POLICY contacts_select_scope ON public.contacts
  USING (is_admin_or_director() OR is_team_scope_allowed() OR (EXISTS ( SELECT 1 FROM appointments a WHERE (a.contact_id = contacts.id) AND ((a.setter_id = auth.uid()) OR (a.closer_id = auth.uid())))) OR (EXISTS ( SELECT 1 FROM sales s WHERE (s.contact_id = contacts.id) AND ((s.setter_id = auth.uid()) OR (s.closer_id = auth.uid())))) OR is_my_collaborator_row(id));
