-- Base de clientes/alumnos completada con Stripe (Configuración → Integraciones → Stripe →
-- "Sincronizar clientes"): cachea el estado real de cobro por cliente de Stripe (pagó una vez,
-- paga mensualmente, o está en mora) para completar la base de clientes/alumnos, que hoy solo
-- refleja lo que se registró a mano en `sales`/`collections`. Se vincula por email a `contacts`
-- cuando hay coincidencia; si no, queda como cliente de Stripe sin vincular (dato igualmente útil
-- para detectar altas que no se registraron en la app).

CREATE TABLE public.stripe_customers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id),
  contact_id          UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  stripe_customer_id  TEXT NOT NULL,
  email               TEXT,
  name                TEXT,
  status              TEXT NOT NULL CHECK (status IN ('cliente', 'activo_mensual', 'moroso', 'cancelado')),
  subscription_id     TEXT,
  current_period_end  TIMESTAMPTZ,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, stripe_customer_id)
);

CREATE TRIGGER stripe_customers_updated_at
  BEFORE UPDATE ON public.stripe_customers
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX stripe_customers_tenant_idx ON public.stripe_customers(tenant_id);
CREATE INDEX stripe_customers_contact_idx ON public.stripe_customers(contact_id);
CREATE INDEX stripe_customers_email_idx ON public.stripe_customers(tenant_id, lower(email));

ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;

-- Mismo patrón de roles que manual_platform_records: admin/director gestionan (la sincronización
-- corre con service role desde el API route), cualquier rol con sesión puede leer el estado.
CREATE POLICY "stripe_customers_all" ON public.stripe_customers FOR ALL USING (is_admin_or_director());
CREATE POLICY "stripe_customers_select_team" ON public.stripe_customers FOR SELECT USING (get_my_role() IS NOT NULL);

-- Aislamiento multi-tenant (mismo patrón que manual_platform_records / 20260911150000).
CREATE POLICY "stripe_customers_tenant_isolation" ON public.stripe_customers AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
