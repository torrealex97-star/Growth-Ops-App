-- Endurecimiento de funciones (auditoría de seguridad, avisos del linter de Supabase).
--
-- 1) `guard_reservation_refund()` es una función de TRIGGER con SECURITY DEFINER. Quedaba ejecutable
--    por `anon` y `authenticated` vía /rest/v1/rpc: una función que devuelve `trigger` no se puede
--    llamar de verdad desde ahí (falla), pero no debe ser invocable por roles externos. Los triggers
--    siguen funcionando: el permiso EXECUTE de una función de trigger se comprueba al CREAR el
--    trigger, no cada vez que dispara.
-- 2) Las dos funciones de normalización del canal del contacto no fijaban `search_path`: con un
--    search_path de rol mutable, un objeto homónimo en otro esquema podría suplantar a uno de
--    `public`. Se fija a `public, pg_temp`.
--
-- Cambio sin efecto en datos, RLS ni en el comportamiento de los triggers.

REVOKE EXECUTE ON FUNCTION public.guard_reservation_refund() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.contacts_normalize_lead_channel(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.contacts_normalize_lead_channel_trigger() SET search_path = public, pg_temp;
