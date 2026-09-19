-- BASE DE COMISIÓN NETA DE PASARELA.
--
-- Regla de negocio: la comisión de TODO el equipo (setter, closer, clásico y
-- colaborador) se calcula sobre lo realmente entrado, no sobre el bruto del
-- cobro. La comisión de la pasarela que procesó el pago se descuenta de la base:
--
--   base = collections.commissionable_amount − fee_de_la_pasarela
--
-- De dónde sale el fee, por prioridad:
--   1. API de Stripe — la fuente real. El espejo `stripe_payments` (170000) pasa
--      a llevar `stripe_fee` (fee del balance_transaction del pago, poblado por
--      lib/finance/stripePaymentsSync.ts vía API). Los cobros manuales que
--      registran su referencia de Stripe (`payment_reference`) la leen de aquí.
--   2. Referencia del plan en el cobro manual — cuando la venta se añade a mano
--      (sin Stripe), `collections.processing_fee` ya guarda la comisión del plan
--      que el formulario registraba para P&L (restada también en la analítica
--      financiera); la reutilizamos como fee en vez de duplicar el dato.
--
-- Nunca por debajo de 0 (un fee mayor que la base acota la base a 0; no genera
-- comisiones negativas por accidente). Las comisiones YA LIQUIDADAS no se
-- recalculan: el histórico pagado es intocable (misma regla que reconcile).

-- 1) El fee REAL de Stripe en el espejo (lo rellena el sync desde la API).
ALTER TABLE public.stripe_payments
  ADD COLUMN IF NOT EXISTS stripe_fee NUMERIC(12,2);

COMMENT ON COLUMN public.stripe_payments.stripe_fee IS
  'Comisión cobrada por Stripe en este pago (balance_transaction.fee, en euros). La rellena el sync vía API; NULL = aún sin refrescar desde Stripe.';

-- 2) La base neta, en UN solo sitio: el motor de comisiones y cualquier
--    proyección futura preguntan aquí en vez de repetir la fórmula.
CREATE OR REPLACE FUNCTION public.commission_base_for_collection(p_collection public.collections)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_base NUMERIC;
  v_fee  NUMERIC;
  v_ref  TEXT;
  v_pay  record;
BEGIN
  v_base := COALESCE(p_collection.commissionable_amount, 0);
  IF v_base <= 0 THEN
    RETURN 0;
  END IF;

  v_fee := NULL;

  -- 1) Fee real de Stripe si el cobro trae referencia y el espejo ya la conoce.
  v_ref := p_collection.payment_reference;
  IF v_ref IS NOT NULL THEN
    EXECUTE
      'SELECT stripe_fee FROM public.stripe_payments
        WHERE tenant_id = $1 AND (payment_id = $2 OR charge_id = $2)
        LIMIT 1'
      INTO v_pay
      USING p_collection.tenant_id, v_ref;
    IF v_pay IS NOT NULL AND v_pay.stripe_fee IS NOT NULL THEN
      v_fee := v_pay.stripe_fee;
    END IF;
  END IF;

  -- 2) Sin Stripe (venta manual): la referencia del plan que guardó el cobro.
  IF v_fee IS NULL THEN
    v_fee := COALESCE(p_collection.processing_fee, 0);
  END IF;

  RETURN GREATEST(v_base - COALESCE(v_fee, 0), 0);
END;
$fn$;

REVOKE ALL ON FUNCTION public.commission_base_for_collection(public.collections)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commission_base_for_collection(public.collections)
  TO authenticated, service_role;
