-- Dashboard de análisis Meta Ads (Marketing › Campañas):
-- · campaign_funnel_assignments — asignación MANUAL de cada campaña a un funnel (dm/vsl/webinar/custom).
--   La sugerencia por nombre es solo sugerencia: el usuario corrige, y esta tabla es la fuente.
-- · meta_custom_funnels — funnels PERSONALIZADOS: etapas elegidas por el usuario entre métricas y
--   action types que Meta devuelve (nunca inventadas).
-- · campaign_daily.meta_actions / meta_action_values — acciones normalizadas por día (jsonb).
--   NULL explícito ≠ 0: si Meta no devolvió la acción, se guarda null (la UI muestra "—");
--   un 0 real de Meta se guarda como 0.

CREATE TABLE public.meta_custom_funnels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  name        TEXT NOT NULL,
  -- Etapas ordenadas: [{ metric: 'landing_page_view' | 'spend' | ..., display_name: text, is_primary: bool }]
  stages      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.campaign_funnel_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  ad_account_id   TEXT,
  campaign_name   TEXT,
  funnel_type     TEXT NOT NULL CHECK (funnel_type IN ('dm', 'vsl', 'webinar', 'custom')),
  custom_funnel_id UUID REFERENCES public.meta_custom_funnels(id) ON DELETE SET NULL,
  assigned_by     UUID REFERENCES public.users(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, campaign_id)
);

CREATE TRIGGER meta_custom_funnels_updated_at
  BEFORE UPDATE ON public.meta_custom_funnels
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.campaign_funnel_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_custom_funnels ENABLE ROW LEVEL SECURITY;

-- Escritura: admin/director/manager/marketing (quien gestiona ads). Lectura: cualquier rol con sesión.
CREATE POLICY "campaign_funnel_assignments_team_write" ON public.campaign_funnel_assignments FOR ALL
  USING (is_admin_or_director() OR get_my_role() IN ('manager', 'marketing'));
CREATE POLICY "campaign_funnel_assignments_select_team" ON public.campaign_funnel_assignments FOR SELECT
  USING (get_my_role() IS NOT NULL);
CREATE POLICY "meta_custom_funnels_team_write" ON public.meta_custom_funnels FOR ALL
  USING (is_admin_or_director() OR get_my_role() IN ('manager', 'marketing'));
CREATE POLICY "meta_custom_funnels_select_team" ON public.meta_custom_funnels FOR SELECT
  USING (get_my_role() IS NOT NULL);

-- Aislamiento multi-tenant (mismo patrón restrictivo que campaign_targets / 20260912200000).
CREATE POLICY "campaign_funnel_assignments_tenant_isolation" ON public.campaign_funnel_assignments
  AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
CREATE POLICY "meta_custom_funnels_tenant_isolation" ON public.meta_custom_funnels
  AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

-- Acciones normalizadas por día (level=campaign, time_increment=1). Mapa action_type → valor,
-- con null EXPLÍCITO cuando Meta no devolvió la acción (0 real se guarda como 0).
ALTER TABLE public.campaign_daily
  ADD COLUMN IF NOT EXISTS meta_actions JSONB,
  ADD COLUMN IF NOT EXISTS meta_action_values JSONB;

CREATE INDEX IF NOT EXISTS campaign_funnel_assignments_campaign_idx
  ON public.campaign_funnel_assignments (campaign_id);
CREATE INDEX IF NOT EXISTS meta_custom_funnels_tenant_idx
  ON public.meta_custom_funnels (tenant_id);
