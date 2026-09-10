-- v46 — Revisión de comisiones en planes personalizados.
-- En un plan de pago 'custom' (personalizado, varias cuotas negociadas a mano por el closer),
-- solo la reserva/entrada (el primer pago que adelanta el cliente) debe comisionar al instante.
-- Las cuotas siguientes, al cobrarlas, deben quedar en revisión manual de cobros en vez de generar
-- comisión real de inmediato (bug: la venta de un plan personalizado marcaba TODAS las cuotas como
-- comisionables el mismo día que se cobraban, sin control del equipo).
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS needs_commission_review BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.collections.needs_commission_review IS
  'TRUE = cobro de una cuota 2+ de un plan personalizado, pendiente de que cobros lo apruebe manualmente antes de generar comisión real. Mientras esté en TRUE, is_eligible_for_commission es FALSE y no hay filas en commissions para este cobro.';

CREATE INDEX IF NOT EXISTS collections_needs_review_idx
  ON public.collections (needs_commission_review)
  WHERE needs_commission_review = TRUE;
