-- S0.5 — Reconciliación de cash entre Stripe (fuente de verdad) y los cobros de la app.
-- Solo lectura. Ver `docs/S0-5-CONSISTENCIA-DATOS.md` para la lectura de los resultados.
--
-- Ejecutar tras cualquier cambio en la conciliación: dice si la diferencia se cierra o se ensancha.

-- 1) El total, por fuente.
SELECT 'Stripe succeeded' AS fuente, count(*) AS n, round(sum(amount), 2) AS importe
  FROM stripe_payments WHERE status = 'succeeded'
UNION ALL
SELECT 'cobros en la app', count(*), round(sum(gross_amount), 2) FROM collections;

-- 2) Pagos de Stripe que la app no tiene registrados, por mes.
SELECT to_char(p.paid_at, 'YYYY-MM') AS mes, count(*) AS pagos, round(sum(p.amount), 2) AS importe
  FROM stripe_payments p
 WHERE p.status = 'succeeded'
   AND NOT EXISTS (
     SELECT 1 FROM collections c
      WHERE c.tenant_id = p.tenant_id
        AND (c.payment_reference = p.payment_id OR c.payment_reference = p.charge_id))
 GROUP BY 1 ORDER BY 1;

-- 3) Cobros registrados contra un pago que Stripe NO dio por bueno (devuelto, fallido…).
SELECT p.status AS estado_en_stripe, count(*) AS cobros, round(sum(c.gross_amount), 2) AS importe
  FROM collections c
  JOIN stripe_payments p
    ON p.tenant_id = c.tenant_id
   AND (p.payment_id = c.payment_reference OR p.charge_id = c.payment_reference)
 WHERE c.payment_provider ILIKE '%stripe%' AND p.status <> 'succeeded'
 GROUP BY 1;

-- 4) Invariantes que hoy se cumplen. Cualquier fila aquí es una regresión.
SELECT 'cobro con referencia inexistente en el espejo' AS caso, count(*) AS filas
  FROM collections c
 WHERE c.payment_provider ILIKE '%stripe%'
   AND NOT EXISTS (
     SELECT 1 FROM stripe_payments p
      WHERE p.tenant_id = c.tenant_id
        AND (p.payment_id = c.payment_reference OR p.charge_id = c.payment_reference))
UNION ALL
SELECT 'par cobro-pago con importe distinto', count(*)
  FROM collections c
  JOIN stripe_payments p
    ON p.tenant_id = c.tenant_id
   AND (p.payment_id = c.payment_reference OR p.charge_id = c.payment_reference)
 WHERE c.payment_provider ILIKE '%stripe%' AND c.gross_amount <> p.amount
UNION ALL
SELECT 'comisión ligada a cobro inexistente', count(*)
  FROM commissions cm
 WHERE cm.collection_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = cm.collection_id)
UNION ALL
SELECT 'referencia de pago duplicada', count(*)
  FROM (SELECT payment_reference FROM collections
         WHERE payment_reference IS NOT NULL AND payment_reference <> ''
         GROUP BY payment_reference HAVING count(*) > 1) d;
