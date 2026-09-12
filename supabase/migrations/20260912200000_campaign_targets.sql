-- Objetivos configurables de ROAS/CAC/CPL por tenant (Campañas → alertas basadas en reglas).
-- Antes las alertas de la página de Campañas no existían: no había forma de saber si un CPL o un
-- CAC eran "buenos" o "malos" sin comparar a ojo con un número mental. Una sola fila por tenant
-- (fila de configuración global, no por campaña) que la UI usa para pintar el estado de cada KPI.

CREATE TABLE public.campaign_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL UNIQUE REFERENCES public.tenants(id),
  target_roas   NUMERIC(10, 2),  -- objetivo mínimo (ROAS por debajo de esto = alerta)
  target_cac    NUMERIC(12, 2),  -- objetivo máximo en € (CAC por encima de esto = alerta)
  target_cpl    NUMERIC(12, 2),  -- objetivo máximo en € (CPL por encima de esto = alerta)
  updated_by    UUID REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER campaign_targets_updated_at
  BEFORE UPDATE ON public.campaign_targets
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.campaign_targets ENABLE ROW LEVEL SECURITY;

-- Solo admin/director pueden fijar los objetivos; cualquier rol con sesión puede leerlos (para
-- pintar el color de alerta en Campañas, que consulta cualquier persona con acceso a esa pantalla).
CREATE POLICY "campaign_targets_admin_write" ON public.campaign_targets FOR ALL USING (is_admin_or_director());
CREATE POLICY "campaign_targets_select_team" ON public.campaign_targets FOR SELECT USING (get_my_role() IS NOT NULL);

-- Aislamiento multi-tenant (mismo patrón que stripe_customers / 20260912170000).
CREATE POLICY "campaign_targets_tenant_isolation" ON public.campaign_targets AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
