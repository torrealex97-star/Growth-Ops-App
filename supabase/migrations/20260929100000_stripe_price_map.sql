-- RECONOCIMIENTO DE PRODUCTO POR PRICE ID DE STRIPE, para la bandeja de cobros pendientes
-- (Payment Inbox, ver lib/sales/payment-inbox.ts y 20260928191947_resolve_payment_inbox.sql).
--
-- POR QUÉ EXISTE. La bandeja ya identifica DE QUIÉN es un pago (por email → contacto), pero exige
-- que un admin/closer elija producto y plan a mano en cada cobro — `sales.product_id`/
-- `payment_plan_id` son NOT NULL y un pago de Stripe no dice a cuál corresponden por sí solo.
-- Esta tabla es la decisión que SÍ permite reconocerlo sin adivinar: un admin dice UNA VEZ qué
-- producto/plan vende cada Price ID de Stripe (Integraciones), y a partir de ahí la bandeja
-- pre-rellena esa elección cuando el cobro trae ese Price ID — la decisión humana ya existe, solo
-- se aplica. Si el pago no trae Price ID (Payment Link de un solo pago sin factura) o el Price ID
-- no está mapeado, la bandeja sigue exigiendo la elección manual de siempre.
CREATE TABLE public.stripe_price_map (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id),
  stripe_price_id   TEXT NOT NULL,
  product_id        UUID NOT NULL REFERENCES public.products(id),
  payment_plan_id   UUID NOT NULL REFERENCES public.payment_plans(id),
  created_by        UUID NOT NULL REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, stripe_price_id)
);

ALTER TABLE public.stripe_price_map ENABLE ROW LEVEL SECURITY;

-- Mismo permiso que resolver la bandeja: quien puede decidir producto/plan de un cobro puede
-- decidir el mapeo que se lo ahorra la próxima vez.
CREATE POLICY "stripe_price_map_select_finance" ON public.stripe_price_map FOR SELECT
  USING (public.is_admin_or_director());
CREATE POLICY "stripe_price_map_write_finance" ON public.stripe_price_map FOR ALL
  USING (public.is_admin_or_director()) WITH CHECK (public.is_admin_or_director());

CREATE POLICY "stripe_price_map_tenant_isolation" ON public.stripe_price_map AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

COMMENT ON TABLE public.stripe_price_map IS
  'Qué producto/plan interno corresponde a cada Price ID de Stripe, decidido una vez por un admin. Usado por la bandeja de cobros pendientes (payment-inbox) para pre-rellenar la elección sin adivinar por importe.';
