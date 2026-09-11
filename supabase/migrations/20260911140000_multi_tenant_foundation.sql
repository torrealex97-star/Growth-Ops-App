-- Multi-tenant foundation: tenants, tenant_members, helper functions, seed.
-- Part of the Scalix Systems multi-tenant conversion (see docs/AUDITORIA-FASE1-2026-09-11.md
-- for the single-tenant baseline this replaces). Idempotent — safe to re-run.

-- ------------------------------------------------------------------
-- 1) Core tables
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS tenant_members_user_idx ON public.tenant_members(user_id);
CREATE INDEX IF NOT EXISTS tenant_members_tenant_idx ON public.tenant_members(tenant_id);

-- ------------------------------------------------------------------
-- 2) Helper functions (SECURITY DEFINER, fixed search_path — see
--    fix_rls_p0_round2 for why: unfixed search_path is a hijack vector).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_tenant_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid();
$$;

-- super_admin is a PLATFORM-level flag, not tied to any one tenant: having
-- role='super_admin' on ANY tenant_members row grants access to every tenant.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$;

-- True if the caller can administer this specific tenant (invite/manage
-- members, edit tenant settings): tenant-level admin, or platform super_admin.
CREATE OR REPLACE FUNCTION public.is_tenant_admin(check_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid() AND tenant_id = check_tenant_id AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_tenant_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_tenant_ids() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(UUID) TO authenticated;

-- ------------------------------------------------------------------
-- 3) RLS on tenants / tenant_members
-- ------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Members can see their own tenant(s); super_admin sees all (needed for the
-- tenant switcher). Slug+status alone (no join) must also be readable by
-- anon for login-time tenant resolution in middleware — a separate narrow
-- policy below covers that without exposing settings/name broadly... actually
-- name is needed for the switcher UI and isn't sensitive, so one SELECT
-- policy covers both authenticated cases; anon gets its own minimal policy.
DROP POLICY IF EXISTS tenants_select_member ON public.tenants;
CREATE POLICY tenants_select_member ON public.tenants FOR SELECT TO authenticated USING (
  id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin()
);

-- Anon (pre-login) needs to resolve a known slug to confirm it exists and is
-- active, to render the /[tenant]/login page vs a 404 — this does not enable
-- listing (no policy allows a bare `select *` without a slug match in code,
-- and RLS itself doesn't restrict which rows come back for a given query,
-- so app code must always filter by slug; this policy only decides whether
-- anon is allowed to read a row at all).
DROP POLICY IF EXISTS tenants_select_anon_by_slug ON public.tenants;
CREATE POLICY tenants_select_anon_by_slug ON public.tenants FOR SELECT TO anon USING (status = 'active');

DROP POLICY IF EXISTS tenants_modify_super_admin ON public.tenants;
CREATE POLICY tenants_modify_super_admin ON public.tenants FOR ALL TO authenticated USING (
  public.is_super_admin()
) WITH CHECK (
  public.is_super_admin()
);

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_members_select ON public.tenant_members;
CREATE POLICY tenant_members_select ON public.tenant_members FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.is_tenant_admin(tenant_id)
);

DROP POLICY IF EXISTS tenant_members_modify ON public.tenant_members;
CREATE POLICY tenant_members_modify ON public.tenant_members FOR ALL TO authenticated USING (
  public.is_tenant_admin(tenant_id)
) WITH CHECK (
  public.is_tenant_admin(tenant_id)
);

-- ------------------------------------------------------------------
-- 4) Seed: evergreen (template, empty) + women-digital-closer tenants,
--    Alex Torre as platform super_admin (tied to evergreen — see is_super_admin()
--    above for why the tie-breaker tenant doesn't matter).
-- ------------------------------------------------------------------
INSERT INTO public.tenants (slug, name, status)
VALUES ('evergreen', 'Evergreen (plantilla)', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tenants (slug, name, status)
VALUES ('women-digital-closer', 'Women Digital Closer', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tenant_members (tenant_id, user_id, role)
SELECT t.id, u.id, 'super_admin'
FROM public.tenants t, public.users u
WHERE t.slug = 'evergreen' AND u.email = 'torre.alex97@gmail.com'
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'super_admin';
