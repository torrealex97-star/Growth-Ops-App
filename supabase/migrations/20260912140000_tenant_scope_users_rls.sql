-- Scope the global identity table to users who share at least one tenant.
-- `users` intentionally has no tenant_id because one identity can belong to
-- multiple tenants, so its RLS must resolve access through tenant_members.

CREATE OR REPLACE FUNCTION public.auth_can_view_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    target_user_id = auth.uid()
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.tenant_members mine
      JOIN public.tenant_members target
        ON target.tenant_id = mine.tenant_id
      WHERE mine.user_id = auth.uid()
        AND target.user_id = target_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_manage_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.tenant_members mine
      JOIN public.tenant_members target
        ON target.tenant_id = mine.tenant_id
      WHERE mine.user_id = auth.uid()
        AND mine.role IN ('admin', 'super_admin')
        AND target.user_id = target_user_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_can_view_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_view_user(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.auth_can_manage_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_manage_user(UUID) TO authenticated;

DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_insert_admin" ON public.users;
DROP POLICY IF EXISTS "users_update_self" ON public.users;
DROP POLICY IF EXISTS "users_delete_admin" ON public.users;
DROP POLICY IF EXISTS "users_update_tenant" ON public.users;
DROP POLICY IF EXISTS "users_delete_tenant" ON public.users;

CREATE POLICY "users_select" ON public.users
  FOR SELECT TO authenticated
  USING (public.auth_can_view_user(id));

-- User creation is performed by the tenant-aware invite endpoint with the
-- service role. Direct authenticated inserts are restricted to platform admins.
CREATE POLICY "users_insert_admin" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "users_update_tenant" ON public.users
  FOR UPDATE TO authenticated
  USING (public.auth_can_manage_user(id))
  WITH CHECK (public.auth_can_manage_user(id));

CREATE POLICY "users_delete_tenant" ON public.users
  FOR DELETE TO authenticated
  USING (public.auth_can_manage_user(id));
