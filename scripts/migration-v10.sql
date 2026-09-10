-- ============================================================
-- MIGRACIÓN v10 — Métodos de pago reales [tenant] + reserva + comisiones plataforma
-- Idempotente.
-- ============================================================

-- payment_plans: método, coste de plataforma y recargo de autofinanciación
ALTER TABLE public.payment_plans ADD COLUMN IF NOT EXISTS method TEXT;                          -- stripe/transferencia/autofinanciado/sequra/reserva
ALTER TABLE public.payment_plans ADD COLUMN IF NOT EXISTS fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0;             -- % coste plataforma/financiera sobre lo cobrado
ALTER TABLE public.payment_plans ADD COLUMN IF NOT EXISTS financing_surcharge_percent NUMERIC(5,2) NOT NULL DEFAULT 0; -- recargo de autofinanciación (informativo)

-- sales: importe de reserva ya pagado (se descuenta al completar el pago)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reservation_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- Rehacer los planes del producto de 6 meses
-- ============================================================
DO $$
DECLARE pid UUID;
BEGIN
  SELECT id INTO pid FROM public.products WHERE name LIKE 'Academia Demo - Master IA Expert (6 meses)%' LIMIT 1;
  IF pid IS NULL THEN RAISE NOTICE 'Producto 6 meses no encontrado'; RETURN; END IF;

  -- Limpiar planes previos (incluye los "X plazos (Sequra)" erróneos y el Full Pay antiguo)
  DELETE FROM public.payment_plans WHERE product_id = pid;

  INSERT INTO public.payment_plans
    (product_id, name, code, gross_price, number_of_payments, method, fee_percent, financing_surcharge_percent, cash_collection_ratio, is_active, sort_order) VALUES
    (pid, 'Reserva (300€)',              'RES',   300.00, 1, 'reserva',        0,    0,   1.0000, TRUE, 0),
    (pid, 'Full Pay Stripe',             'FPS',  1997.00, 1, 'stripe',         5.00, 0,   0.9500, TRUE, 1),
    (pid, 'Full Pay Transferencia',      'FPT',  1997.00, 1, 'transferencia',  3.00, 0,   0.9700, TRUE, 2),
    (pid, 'Autofinanciado 2 pagos',      'AF2',  2296.55, 2, 'autofinanciado', 5.00, 15,  0.9500, TRUE, 3),
    (pid, 'Autofinanciado 3 pagos',      'AF3',  2346.48, 3, 'autofinanciado', 5.00, 17.5,0.9500, TRUE, 4),
    (pid, 'Autofinanciado 4 pagos',      'AF4',  2396.40, 4, 'autofinanciado', 5.00, 20,  0.9500, TRUE, 5),
    (pid, 'Sequra 3 plazos',             'SEQ3', 1997.00, 3, 'sequra',         30.00,0,   0.7000, TRUE, 6),
    (pid, 'Sequra 6 plazos',             'SEQ6', 1997.00, 6, 'sequra',         30.00,0,   0.7000, TRUE, 7),
    (pid, 'Sequra 9 plazos',             'SEQ9', 1997.00, 9, 'sequra',         30.00,0,   0.7000, TRUE, 8),
    (pid, 'Sequra 12 plazos',            'SEQ12',1997.00,12, 'sequra',         30.00,0,   0.7000, TRUE, 9);
END $$;
