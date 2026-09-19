-- campaign_funnel_assignments — asignación MANUAL de funnel por campaña
-- (Marketing › Campañas → dashboard Meta Ads / MetaFunnelAssigner).
--
-- Contrato exacto con app/api/[tenant]/evergreen/meta/campaign-funnels:
--   GET  select(campaign_id, funnel_type, custom_funnel_id, assigned_at).eq(tenant_id)
--   PUT  upsert({tenant_id, campaign_id, funnel_type, custom_funnel_id, assigned_by, assigned_at},
--               onConflict 'tenant_id,campaign_id')
-- La sugerencia por nombre es solo sugerencia: esta tabla es la fuente de verdad y el
-- usuario puede cambiar la asignación en cualquier momento sin resincronizar.

CREATE TABLE IF NOT EXISTS public.campaign_funnel_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id      UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  funnel_type      TEXT NOT NULL CHECK (funnel_type IN ('dm', 'vsl', 'webinar', 'custom')),
  custom_funnel_id UUID,                          -- libre: aún no existe tabla de funnels custom
  assigned_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, campaign_id)                 -- exactamente el onConflict del upsert
);

CREATE INDEX IF NOT EXISTS idx_cfa_tenant   ON public.campaign_funnel_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cfa_campaign ON public.campaign_funnel_assignments(campaign_id);

ALTER TABLE public.campaign_funnel_assignments ENABLE ROW LEVEL SECURITY;

-- Policies solo-rol (patrón de 20260919110000_rls_tenant_isolation_remediation).
-- El endpoint usa service_role (bypassa RLS); estas policies protegen el acceso directo
-- de clientes authenticated (dashboard client, PostgREST con JWT de usuario).
DROP POLICY IF EXISTS cfa_select ON public.campaign_funnel_assignments;
CREATE POLICY cfa_select ON public.campaign_funnel_assignments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS cfa_insert ON public.campaign_funnel_assignments;
CREATE POLICY cfa_insert ON public.campaign_funnel_assignments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS cfa_update ON public.campaign_funnel_assignments;
CREATE POLICY cfa_update ON public.campaign_funnel_assignments FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS cfa_delete ON public.campaign_funnel_assignments;
CREATE POLICY cfa_delete ON public.campaign_funnel_assignments FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
