-- Endurecimiento de funciones (auditoría de seguridad, docs/SECURITY_HARDENING.md).
-- APLICADA en producción el 2026-10-05 desde el editor SQL de Supabase (no vía `apply_migration`, por lo
-- que no figura en supabase_migrations.schema_migrations). Idempotente: se puede volver a ejecutar.
--
-- · `guard_reservation_refund()` es una función de TRIGGER SECURITY DEFINER: no debe ser invocable por
--   roles externos. Los triggers siguen disparando (el permiso EXECUTE se comprueba al crear el trigger).
-- · Se fija `search_path` en las dos funciones de normalización del canal del contacto.

REVOKE EXECUTE ON FUNCTION public.guard_reservation_refund() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.contacts_normalize_lead_channel(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.contacts_normalize_lead_channel_trigger() SET search_path = public, pg_temp;
