-- ─────────────────────────────────────────────────────────────────────────────
-- HARDENING SQL: Revocar EXECUTE público de las funciones SECURITY DEFINER y triggers.
-- Cierra la advertencia pendiente reportada por Supabase Security Advisor (PROJECT_CONTEXT.md).
--
-- QUÉ PASABA. Por defecto en PostgreSQL, `CREATE FUNCTION` concede `EXECUTE` al rol pseudo-público
-- `PUBLIC`, lo que incluye a `anon` (usuarios no autenticados en PostgREST).
-- PostgREST publica automáticamente cualquier función en el esquema `public` accesible por `anon`
-- o `authenticated` como endpoint RPC (`/rest/v1/rpc/<nombre>`).
--
-- Para funciones marcadas como `SECURITY DEFINER` (que se ejecutan con privilegios de superusuario/owner),
-- dejar `EXECUTE` concedido a `PUBLIC` o `anon` permite que cualquier visitante anónimo invoque
-- directamente funciones internas como `auth_tenant_ids`, `is_super_admin`, etc.
--
-- Para funciones de TRIGGER (`handle_updated_at`, `suggestions_set_resolved_at`, etc.), ningún
-- rol de API necesita ejecutarlas (solo el motor de base de datos al disparar el trigger).
--
-- EL ARREGLO (idempotente):
-- 1. Revocar `EXECUTE` de `PUBLIC` y `anon` para las 10 funciones helper RLS (SECURITY DEFINER).
--    Se mantiene `GRANT EXECUTE TO authenticated` únicamente para aquellas requeridas por las políticas RLS
--    o llamadas legítimas autenticadas de la app (`is_super_admin`).
-- 2. Revocar `ALL` de `PUBLIC`, `anon` y `authenticated` para todas las funciones de TRIGGER.
-- 3. Revocar `ALL` de `PUBLIC` y `anon` para funciones utilitarias de servidor (`contacts_get_or_create`,
--    `merge_contacts`).
-- ─────────────────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- 1) FUNCIONES DE TRIGGER (Nunca deben ser invocables vía PostgREST RPC)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suggestions_set_resolved_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.positive_notes_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partners_check_profit_total() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) LAS 10 FUNCIONES RLS HELPER (SECURITY DEFINER)
--    Cerradas a `PUBLIC` y `anon`. Concedidas a `authenticated` para evaluación de RLS.
-- -----------------------------------------------------------------------------

-- 1. get_my_role
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- 2. is_admin_or_director
REVOKE ALL ON FUNCTION public.is_admin_or_director() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_director() TO authenticated;

-- 3. my_data_scope
REVOKE ALL ON FUNCTION public.my_data_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_data_scope() TO authenticated;

-- 4. auth_tenant_ids
REVOKE ALL ON FUNCTION public.auth_tenant_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_tenant_ids() TO authenticated;

-- 5. is_super_admin
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- 6. is_tenant_admin
REVOKE ALL ON FUNCTION public.is_tenant_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(UUID) TO authenticated;

-- 7. auth_can_view_user
REVOKE ALL ON FUNCTION public.auth_can_view_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_view_user(UUID) TO authenticated;

-- 8. auth_can_manage_user
REVOKE ALL ON FUNCTION public.auth_can_manage_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_manage_user(UUID) TO authenticated;

-- 9. rol_recortado_en
REVOKE ALL ON FUNCTION public.rol_recortado_en(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rol_recortado_en(UUID) TO authenticated;

-- 10. rol_en_tenant
REVOKE ALL ON FUNCTION public.rol_en_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rol_en_tenant(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) FUNCIONES DE SERVICIO / FUSIÓN
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.merge_contacts(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_contacts(UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.contacts_get_or_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_get_or_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ) TO authenticated;
