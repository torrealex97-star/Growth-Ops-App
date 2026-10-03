-- F01 (auditoría de dashboards, P0): un COLABORADOR NO PUEDE LEER LOS DATOS DEL EQUIPO.
--
-- QUÉ PASABA (medido en producción el 3-oct, transacción de solo lectura revertida con ROLLBACK):
--   un colaborador con 0 ventas y 0 contactos propios veía 36 de 36 ventas, 636 de 636 citas,
--   686 de 688 contactos, 62 de 62 cobros y 82 de 82 pagos de Stripe de la subcuenta.
--   Las comisiones sí estaban cerradas (0 de 31): el fallo está solo en las políticas de abajo.
--
-- POR QUÉ. Las políticas `*_select_scope` dan acceso total cuando `my_data_scope() = 'team'`, y
-- `users.data_scope` tiene DEFAULT 'team': todos los usuarios nacen con visibilidad de toda la
-- subcuenta, colaboradores incluidos (los 12 usuarios actuales están en 'team'). El comentario de
-- lib/collaborators/scope.ts presenta el RLS como «el backstop» de ese filtro de app; con este
-- default no lo era. Además `stripe_payments` y `stripe_customers` (con el correo del cliente) los
-- podía leer CUALQUIER miembro de la subcuenta.
--
-- QUÉ HACE. Introduce `soy_colaborador()` y la usa para quitarle a un colaborador el atajo `team`
-- en las ocho políticas afectadas. Un colaborador conserva SUS filas por las vías que ya existían
-- (`is_my_collaborator_row/sale`, setter_id/closer_id = él). Admin y director no cambian: su rama
-- (`is_admin_or_director()`) va aparte.
--
-- QUÉ NO HACE, A PROPÓSITO.
--   · NO cambia el DEFAULT de `users.data_scope` ni los 'team' existentes: qué ve un closer, un
--     setter o un CSM es una decisión de negocio, no de seguridad (ver DASHBOARD_AUDIT, F01).
--   · NO toca la lectura de `stripe_payments` para closers y setters: el Dashboard de equipo la usa
--     para el cash canónico, y quitársela cambiaría sus cifras sin avisar.
--
-- «Colaborador» = tiene fila en `collaborator_profiles` en alguna de sus subcuentas, en CUALQUIER
-- estado (invited, pending_contract, suspended…). Cerrar solo los `active` dejaba abierto justo el
-- intervalo en que alguien ya tiene login pero aún no ha firmado: la capa de app trata «no activo»
-- como «no colaborador» (resolverScopeColaborador → none), así que esto es lo único que lo cubre.
-- Si alguien fuera colaborador en una subcuenta y closer en otra, quedaría acotado en ambas:
-- falla hacia cerrar, no hacia abrir.

BEGIN;

CREATE OR REPLACE FUNCTION public.soy_colaborador()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collaborator_profiles cp
    WHERE cp.user_id = auth.uid()
      AND cp.tenant_id IN (SELECT public.auth_tenant_ids())
  );
$$;

-- Misma disciplina que is_super_admin(): nadie sin sesión ejecuta un SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION public.soy_colaborador() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soy_colaborador() TO authenticated, service_role;

-- ── LAS SEIS POLÍTICAS DE `team` ─────────────────────────────────────────────────────────────
-- Único cambio: `my_data_scope() = 'team'` pasa a `(my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))`.

ALTER POLICY sales_select_scope ON public.sales USING (
  is_admin_or_director()
  OR (my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
  OR is_my_collaborator_sale(id)
);

ALTER POLICY appointments_select_scope ON public.appointments USING (
  is_admin_or_director()
  OR (my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
  OR is_my_collaborator_row(contact_id)
);

ALTER POLICY contacts_select_scope ON public.contacts USING (
  is_admin_or_director()
  OR (my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))
  OR EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.contact_id = contacts.id AND (a.setter_id = auth.uid() OR a.closer_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.contact_id = contacts.id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid())
  )
  OR is_my_collaborator_row(id)
);

ALTER POLICY collections_select_scope ON public.collections USING (
  is_admin_or_director()
  OR (my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))
  OR EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = collections.sale_id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid())
  )
  OR is_my_collaborator_sale(sale_id)
);

ALTER POLICY contact_attributions_select_scope ON public.contact_attributions USING (
  is_admin_or_director()
  OR (my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))
  OR EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.contact_id = contact_attributions.contact_id AND (a.setter_id = auth.uid() OR a.closer_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.contact_id = contact_attributions.contact_id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid())
  )
  OR is_my_collaborator_row(contact_id)
);

ALTER POLICY activities_select ON public.activities USING (
  is_admin_or_director()
  OR (my_data_scope() = 'team' AND NOT (SELECT public.soy_colaborador()))
  OR person_id = auth.uid()
);

-- ── STRIPE: LEÍDO POR CUALQUIER MIEMBRO DE LA SUBCUENTA ──────────────────────────────────────
-- Pagos y clientes (con correo) quedan fuera del alcance de un colaborador. El resto de miembros
-- conserva lo que tenía (ver «Qué NO hace»).

ALTER POLICY stripe_payments_select_team ON public.stripe_payments USING (
  (tenant_id IN (SELECT auth_tenant_ids()) AND NOT (SELECT public.soy_colaborador()))
  OR is_super_admin()
  OR is_admin_or_director()
);

ALTER POLICY stripe_customers_select_team ON public.stripe_customers USING (
  (tenant_id IN (SELECT auth_tenant_ids()) AND NOT (SELECT public.soy_colaborador()))
  OR is_super_admin()
  OR is_admin_or_director()
);

COMMIT;
