-- F05 (DASHBOARD_AUDIT.md) · MONEY D5: una devolución resta del cash CUANDO OCURRE, no del mes del
-- cobro original. `stripe_payments` solo guardaba `refunded_amount`, sin fecha, así que un reembolso
-- de hoy sobre un cobro de hace tres meses restaba del mes equivocado (o no restaba, si el cobro
-- quedaba fuera del lote consultado).
--
-- `refunded_at` = momento de la ÚLTIMA devolución del pago (created del refund en Stripe). NULL =
-- sin devolución o fecha aún no conocida; el código trata «con refunded_amount > 0 y refunded_at NULL»
-- como devolución sin fecha (se avisa, no se asume el mes del cobro).
--
-- Cambio puramente aditivo (columna nullable + índice parcial): no reescribe filas ni cambia RLS.
-- Las políticas de `stripe_payments` (aislamiento y alcance) se aplican igual a la columna nueva.

ALTER TABLE public.stripe_payments
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

COMMENT ON COLUMN public.stripe_payments.refunded_at IS
  'Fecha de la última devolución del pago (Stripe refund.created). NULL = sin devolución o fecha desconocida (MONEY D5).';

CREATE INDEX IF NOT EXISTS stripe_payments_tenant_refunded_at_idx
  ON public.stripe_payments (tenant_id, refunded_at)
  WHERE refunded_at IS NOT NULL;
