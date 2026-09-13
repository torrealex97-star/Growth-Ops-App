-- La función del trigger de socios es SECURITY DEFINER y, al vivir en el esquema `public`, PostgREST
-- la publica como /rest/v1/rpc/partners_check_profit_total, ejecutable por `anon` y `authenticated`.
-- Lo detectó el linter de Supabase justo después de aplicar el guard.
--
-- Explotabilidad real: baja — una función de trigger sin NEW falla en cuanto se invoca. Pero la
-- superficie sobra y no cuesta nada cerrarla: la única llamada legítima es la del propio trigger,
-- que se ejecuta como dueño de la tabla y por tanto no necesita este EXECUTE.
--
-- VERIFICADO tras revocar: un reparto de 70 + 40 sigue siendo rechazado con check_violation.
REVOKE ALL ON FUNCTION public.partners_check_profit_total() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partners_check_profit_total() FROM anon;
REVOKE ALL ON FUNCTION public.partners_check_profit_total() FROM authenticated;
