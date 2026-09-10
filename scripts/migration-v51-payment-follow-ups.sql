-- ============================================================
-- MIGRACIÓN v51 — Seguimiento (notas) en el pipeline de pagos
-- Idempotente.
-- ============================================================
-- Log de notas append-only por venta (llamadas, promesas de pago, acuerdos...),
-- visible en /evergreen/pagos y en el detalle de la venta. No sustituye a
-- sales.notes (que es un único campo editable): esto es un HISTORIAL con
-- autor y fecha, no se edita ni se borra una vez creado.

CREATE TABLE IF NOT EXISTS public.payment_follow_ups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_follow_ups_sale_id
  ON public.payment_follow_ups (sale_id, created_at DESC);

ALTER TABLE public.payment_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_follow_ups_select" ON public.payment_follow_ups;
CREATE POLICY "payment_follow_ups_select" ON public.payment_follow_ups
  FOR SELECT USING (get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS "payment_follow_ups_insert" ON public.payment_follow_ups;
CREATE POLICY "payment_follow_ups_insert" ON public.payment_follow_ups
  FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);

-- ============================================================
-- FIN v51
-- ============================================================
