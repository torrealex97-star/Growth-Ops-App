-- ============================================================
-- STRIPE PAYMENTS — espejo de pagos como FUENTE PRIMARIA de Cash Collected
-- ============================================================
-- Papel de la tabla (§2 de la spec del dashboard global): la métrica cash_collected declara
-- `stripe` como fuente primaria. Hasta ahora ese primario era aspiracional: el webhook solo
-- registra en `raw_events` (a propósito, porque un pago no crea venta sin producto y plan), y
-- `collections` seguía siendo el único dato de cash.
--
-- Con este espejo:
--   · `stripe_payments` guarda CADA pago liquidado de la cuenta de Stripe (succeeded), con su
--     devolución como `refunded_amount` — nunca como fila aparte, porque el reembolso no es
--     dinero que entra: es una parte del pago que sale.
--   · `collections` (registro interno, con venta, producto y comisiones) queda como FALLBACK y
--     como contraste: los pagos no cubiertos por Stripe (transferencia, SeQura, manual) siguen
--     entrando en el cash por la cadena de respaldo, deduplicados por transaction_id.
--   · La reconciliación entre ambas es `lib/canonical/cash.ts` (pura, testeable) y los conflictos
--     de importe quedan REGISTRADOS, nunca resueltos en silencio (§19).
--
-- No reemplaza a `collections`: la venta sigue necesitando la decisión humana de producto y plan
-- (ver lib/finance/stripeImport.ts). Este espejo solo responde "cuánto dinero entró por Stripe",
-- que es lo que un dashboard financiero necesita saber SIEMPRE, haya o no venta registrada.

CREATE TABLE public.stripe_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- payment_intent de Stripe: el nivel canónico del dinero (ver lib/stripe/webhook.ts).
  payment_id        TEXT NOT NULL,
  charge_id         TEXT,
  customer_id       TEXT,
  customer_email    TEXT,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  -- Parte devuelta del mismo pago. Restar filas partiría la unidad de evento.
  refunded_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency          TEXT NOT NULL DEFAULT 'eur',
  status            TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded','refunded','partially_refunded','disputed')),
  -- Marca temporal de Stripe (created del intent), no la del sync: es la que sitúa el cash.
  paid_at           TIMESTAMPTZ,
  metadata          JSONB,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, payment_id)
);

CREATE INDEX stripe_payments_tenant_paid_at_idx ON public.stripe_payments (tenant_id, paid_at DESC);
CREATE INDEX stripe_payments_tenant_customer_idx ON public.stripe_payments (tenant_id, customer_id);

CREATE TRIGGER stripe_payments_updated_at
  BEFORE UPDATE ON public.stripe_payments
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.stripe_payments ENABLE ROW LEVEL SECURITY;
-- Mismo reparto que collections: admin/director escriben, el resto del equipo solo lee.
CREATE POLICY "stripe_payments_all"         ON public.stripe_payments FOR ALL   USING (is_admin_or_director());
CREATE POLICY "stripe_payments_select_team" ON public.stripe_payments FOR SELECT USING (get_my_role() IS NOT NULL);

REVOKE ALL ON public.stripe_payments FROM anon, authenticated;
GRANT SELECT ON public.stripe_payments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.stripe_payments TO authenticated;
