-- La función solo debe ejecutarse como parte del trigger de borrado de definiciones.
-- No es una RPC pública: SECURITY DEFINER + search_path fijo no justifica exponer
-- EXECUTE a anon ni authenticated.
--
-- REVOKE es idempotente y no afecta al trigger ya creado: PostgreSQL comprueba el
-- privilegio de la función de trigger al crear el trigger, no en cada ejecución.
REVOKE EXECUTE ON FUNCTION public.cleanup_custom_field_values() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_custom_field_values() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_custom_field_values() FROM authenticated;
