-- Cierre de 2 hallazgos del advisor de seguridad de Supabase (10-oct-2026):
--  1) `reservation_refund_requests`: RLS habilitada sin ninguna policy (lint 0008).
--  2) `career.raw_immutability_guard`: search_path mutable en una función de trigger (lint 0011).

-- ------------------------------------------------------------------
-- 1) Policy de lectura por subcuenta (mismo patrón que el resto del repo).
--    La tabla solo recibe escrituras por service_role desde la ruta de reembolsos
--    (app/api/[tenant]/evergreen/sales/reservation-refund), que ya filtra por
--    requireTenant; la policy de SELECT es el backstop para cualquier lectura futura
--    con sesión y cierra el lint. Sin grants de escritura para anon/authenticated:
--    nadie inserta directo desde el cliente.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS reservation_refund_requests_admin_select ON public.reservation_refund_requests;
CREATE POLICY reservation_refund_requests_admin_select ON public.reservation_refund_requests
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()));

GRANT SELECT ON TABLE public.reservation_refund_requests TO authenticated;

-- ------------------------------------------------------------------
-- 2) search_path fijo (vacío) en el trigger de inmutabilidad: cualquier objeto no
--    cualificado dentro de la función resuelve por su owner, no por el search_path
--    mutable de quien dispara el trigger. Semántica idéntica (la función no usa
--    objetos no cualificados), riesgo de secuestro de search_path eliminado.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION career.raw_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'raw_items are immutable';
  END IF;
  RETURN NULL;
END;
$fn$;
