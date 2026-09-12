-- Defensa en profundidad para el hallazgo de la auditoría de seguridad final: sales/update y
-- collections/record aceptaban gross_amount/affiliate_commission_percent/commissionable_amount sin
-- validar rango en la capa de aplicación (ya corregido ahí) — estos CHECK son el backstop a nivel
-- de base de datos por si algún otro camino (fix manual por SQL editor, script, endpoint futuro)
-- vuelve a escribir un valor absurdo. NOT VALID: no bloquea la migración si ya existe algún dato
-- fuera de rango (algo que este propio hallazgo sugiere que podría haber ocurrido) — valida solo
-- los INSERT/UPDATE nuevos a partir de ahora. Repasar luego con `SELECT * FROM sales WHERE
-- gross_amount < 0 OR affiliate_commission_percent NOT BETWEEN 0 AND 100` (y el equivalente en
-- collections) para decidir si limpiar datos históricos y poder VALIDATE el constraint.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_gross_amount_nonneg') THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_gross_amount_nonneg CHECK (gross_amount >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_affiliate_percent_range') THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_affiliate_percent_range
      CHECK (affiliate_commission_percent IS NULL OR affiliate_commission_percent BETWEEN 0 AND 100) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_gross_amount_nonneg') THEN
    ALTER TABLE public.collections
      ADD CONSTRAINT collections_gross_amount_nonneg CHECK (gross_amount >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_commissionable_nonneg') THEN
    ALTER TABLE public.collections
      ADD CONSTRAINT collections_commissionable_nonneg CHECK (commissionable_amount >= 0) NOT VALID;
  END IF;
END $$;

-- Deliberadamente NO se añade aquí `commissionable_amount <= gross_amount` a nivel de DB: aunque es
-- la invariante de negocio esperada, hay varios caminos de inserción (payments/mark,
-- collections/[id] al editar) que esta sesión no ha podido verificar uno por uno contra datos
-- reales — un CHECK mal calibrado ahí podría romper un flujo legítimo en producción sin poder
-- probarlo. Esa invariante concreta queda validada solo en la capa de aplicación (endpoint
-- collections/record, el que recibía el valor directamente del body de la request).
