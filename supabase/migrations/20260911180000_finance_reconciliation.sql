-- Soporte de la nueva pestaña "Conciliación" (Finanzas › Cobros & Conciliación): registro manual
-- de movimientos de plataformas sin API de cotejo automático (transferencia, Bizum, PayPal...).
-- Los cobros de Stripe y sequra se cotejan en vivo contra sus APIs — no necesitan tabla propia.

CREATE TABLE public.manual_platform_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id),
  platform       TEXT NOT NULL CHECK (platform IN ('transferencia','bizum','paypal','otro')),
  reference      TEXT,
  amount         NUMERIC(12,2) NOT NULL,
  transacted_at  DATE NOT NULL,
  notes          TEXT,
  matched_collection_id UUID REFERENCES public.collections(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES public.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX manual_platform_records_tenant_idx ON public.manual_platform_records(tenant_id);
CREATE INDEX manual_platform_records_platform_idx ON public.manual_platform_records(tenant_id, platform);

ALTER TABLE public.manual_platform_records ENABLE ROW LEVEL SECURITY;

-- Mismo patrón de roles que collections/refunds: admin/director gestionan, cualquier rol con
-- sesión puede leer (la pantalla de Conciliación ya está detrás de un check admin/director/cobros
-- en el propio API route, esto es solo el backstop de BBDD).
CREATE POLICY "manual_platform_records_all" ON public.manual_platform_records FOR ALL USING (is_admin_or_director());
CREATE POLICY "manual_platform_records_select_team" ON public.manual_platform_records FOR SELECT USING (get_my_role() IS NOT NULL);

-- Aislamiento multi-tenant (mismo patrón que 20260911150000_multi_tenant_domain_tables.sql).
CREATE POLICY "manual_platform_records_tenant_isolation" ON public.manual_platform_records AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
