-- Recrea la gestión de socios y su % de beneficios (la tabla partners original se eliminó en
-- drop_partners porque no tenía ninguna FK entrante ni consumidor en el código: era config muerta).
-- El usuario pidió explícitamente mantener un lugar para añadir socios y su % de beneficios, así
-- que se recrea limpia, sin arrastrar la deuda de antes (sin user_id opcional sin usar).

CREATE TABLE public.partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id),
  name            TEXT NOT NULL,
  profit_percent  NUMERIC(5, 2) NOT NULL CHECK (profit_percent >= 0 AND profit_percent <= 100),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX partners_tenant_id_idx ON public.partners(tenant_id);

CREATE TRIGGER partners_updated_at
  BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- Dato financiero/organizacional sensible: solo admin/director gestionan socios; el resto del
-- equipo con sesión puede leerlos (mismo patrón que campaign_targets).
CREATE POLICY "partners_admin_write" ON public.partners FOR ALL USING (is_admin_or_director());
CREATE POLICY "partners_select_team" ON public.partners FOR SELECT USING (get_my_role() IS NOT NULL);

-- Aislamiento multi-tenant (mismo patrón que campaign_targets / stripe_customers).
CREATE POLICY "partners_tenant_isolation" ON public.partners AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
