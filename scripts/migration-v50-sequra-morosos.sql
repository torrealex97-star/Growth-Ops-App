-- ============================================================
-- v50 — Morosos sequra (solo [tenant])
--   Tabla de clientes con cuotas de sequra realmente vencidas (impago),
--   sincronizada periódicamente desde la API de sequra (ver
--   app/api/evergreen/cron/sequra-morosos). Solo merchant "[tenant]";
--   [tenant] tendrá su propia app/tabla equivalente más adelante.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sequra_delinquent_customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference    TEXT NOT NULL UNIQUE,       -- primary_reference del pedido en sequra
  merchant_reference TEXT NOT NULL DEFAULT 'Academia Demo'
    CHECK (merchant_reference = '<merchant-del-tenant>'),     -- solo [tenant]; garantía a nivel de BBDD
  customer_name      TEXT,
  customer_email     TEXT,
  product_name       TEXT,
  order_value        NUMERIC(12,2),               -- importe total del pedido
  debt_amount        NUMERIC(12,2),               -- importe vencido sin pagar
  overdue_days       INTEGER,
  overdue_since      DATE,
  status             TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'contactado', 'recuperado', 'incobrable')),
  notes              TEXT,
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS sequra_delinquent_customers_updated_at ON public.sequra_delinquent_customers;
CREATE TRIGGER sequra_delinquent_customers_updated_at
  BEFORE UPDATE ON public.sequra_delinquent_customers
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX IF NOT EXISTS sequra_delinquent_customers_status_idx
  ON public.sequra_delinquent_customers(status);

ALTER TABLE public.sequra_delinquent_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sequra_delinquent_customers_select ON public.sequra_delinquent_customers;
CREATE POLICY sequra_delinquent_customers_select ON public.sequra_delinquent_customers
  FOR SELECT USING (get_my_role() IN ('admin', 'director', 'manager', 'cobros'));

DROP POLICY IF EXISTS sequra_delinquent_customers_modify ON public.sequra_delinquent_customers;
CREATE POLICY sequra_delinquent_customers_modify ON public.sequra_delinquent_customers
  FOR ALL USING (get_my_role() IN ('admin', 'director', 'cobros'))
  WITH CHECK (get_my_role() IN ('admin', 'director', 'cobros'));

-- ============================================================
-- FIN v50
-- ============================================================
