-- SEGURIDAD — hallazgo de la auditoría S1 (docs/S1-MVP-READINESS-2026-10-01.md §Fase 3).
--
-- `attribute_ghl_contacts_for_collaborator(p_tenant_id, p_profile_id, p_code)` es SECURITY DEFINER
-- (salta RLS) y el advisor de Supabase reportó que `anon` y `authenticated` podían ejecutarla
-- directamente vía /rest/v1/rpc/. La función no verifica quién llama — solo valida que los
-- parámetros no estén vacíos — y reasigna `collaborator_id` en `contact_attributions` de
-- CUALQUIER tenant_id que se le pase, para contactos cuyo `utm_content` coincida con el código.
--
-- Los códigos de colaborador son PÚBLICOS por diseño (van en los links de referido que cada
-- afiliado comparte). Combinado con un tenant_id (tampoco secreto: aparece en la URL pública de
-- alta de afiliados), cualquiera sin sesión podía robar la atribución de comisiones de otro
-- colaborador llamando al RPC directamente, sin pasar por la aplicación.
--
-- Verificado en el código (grep en el repo): esta función SOLO se invoca internamente con PERFORM
-- desde otras funciones SECURITY DEFINER (los triggers ghl_backfill_on_membership/
-- _on_profile_change/_on_user_role de la migración 20260921194500). Ningún camino de la app la
-- llama por RPC. Revocar el acceso directo no rompe nada: las llamadas internas desde otro
-- SECURITY DEFINER corren con los privilegios del dueño de la función, no con los del rol HTTP.
--
-- Mismo patrón de hardening ya aplicado el 17-sep a otras funciones (ver PROJECT_CONTEXT.md).
REVOKE EXECUTE ON FUNCTION public.attribute_ghl_contacts_for_collaborator(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Higiene adicional: los triggers que el linter marcó como "anon/authenticated-executable" por el
-- mismo motivo (no toman sesión, no deberían llamarse como RPC directo). Llamarlos directamente ya
-- fallaría en tiempo de ejecución al no existir TG_OP/NEW/OLD fuera de un trigger real, así que no
-- son explotables como el caso de arriba — pero revocar el EXECUTE evita filtrar esa información
-- por el mensaje de error y cierra el resto de hallazgos del mismo advisor.
REVOKE EXECUTE ON FUNCTION public.ghl_backfill_on_membership()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ghl_backfill_on_profile_change()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ghl_backfill_on_user_role()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_collaborator_profile()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_collaborator_profile_on_membership()
  FROM PUBLIC, anon, authenticated;
