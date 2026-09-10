-- v35 — Facturas de comisiones del equipo. Cada closer/setter/afiliado adjunta
--   su factura del mes (PDF en Storage). Solo ve las suyas; admin/director ven todas.
--   Requiere el helper is_admin_or_director() y handle_updated_at() (ya existentes).
--   Idempotente.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.commission_invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,               -- primer día del mes facturado
  invoice_url  TEXT,                         -- PDF en el bucket 'facturas'
  amount       NUMERIC(12,2),                -- importe facturado (informativo)
  status       TEXT NOT NULL DEFAULT 'recibida', -- recibida | pagada
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);

CREATE INDEX IF NOT EXISTS commission_invoices_user_idx ON public.commission_invoices(user_id);
CREATE INDEX IF NOT EXISTS commission_invoices_month_idx ON public.commission_invoices(period_month);

DROP TRIGGER IF EXISTS commission_invoices_updated_at ON public.commission_invoices;
CREATE TRIGGER commission_invoices_updated_at
  BEFORE UPDATE ON public.commission_invoices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.commission_invoices ENABLE ROW LEVEL SECURITY;

-- SELECT: propias o (admin/director) todas.
DROP POLICY IF EXISTS commission_invoices_select ON public.commission_invoices;
CREATE POLICY commission_invoices_select ON public.commission_invoices
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin_or_director());

-- INSERT: solo la propia (o admin/director en nombre de cualquiera).
DROP POLICY IF EXISTS commission_invoices_insert ON public.commission_invoices;
CREATE POLICY commission_invoices_insert ON public.commission_invoices
  FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_admin_or_director());

-- UPDATE: la propia (el comercial puede reemplazar su PDF) o admin/director (marcar pagada).
DROP POLICY IF EXISTS commission_invoices_update ON public.commission_invoices;
CREATE POLICY commission_invoices_update ON public.commission_invoices
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin_or_director())
  WITH CHECK (user_id = auth.uid() OR public.is_admin_or_director());

-- DELETE: la propia o admin/director.
DROP POLICY IF EXISTS commission_invoices_delete ON public.commission_invoices;
CREATE POLICY commission_invoices_delete ON public.commission_invoices
  FOR DELETE USING (user_id = auth.uid() OR public.is_admin_or_director());
