-- ============================================================
-- MIGRACIÓN v5 — Control de pagos/morosidad, rol Cobros, gastos recurrentes
-- Idempotente.
-- ============================================================

-- --- Rol Cobros (miembro que controla la morosidad) ---
INSERT INTO public.roles (key, name, description)
SELECT 'cobros','Cobros / Morosidad','Control de pagos pendientes y morosidad'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='cobros');

-- --- Cuotas previstas: seguimiento de morosidad ---
ALTER TABLE public.sale_expected_installments ADD COLUMN IF NOT EXISTS flagged_delinquent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sale_expected_installments ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.sale_expected_installments ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

-- --- Gastos automáticos (recurrentes + sueldos): dedupe por origen+periodo ---
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS auto_source TEXT; -- p.ej. 'salary:<userId>' o 'recurring:<expenseId>'
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS period TEXT;      -- 'YYYY-MM'
-- Índice único NO parcial (los gastos manuales tienen auto_source/period NULL y
-- Postgres permite múltiples NULLs; el ON CONFLICT del cron necesita un índice no parcial).
CREATE UNIQUE INDEX IF NOT EXISTS expenses_auto_period_uidx
  ON public.expenses(auto_source, period);

-- --- Cobros puede leer (usa scope de equipo; aseguramos SELECT en cuotas/cobros) ---
-- installments ya tiene installments_select_team (get_my_role() IS NOT NULL) → cobros incluido.
-- collections: garantizar SELECT para cualquier rol autenticado (cobros incluido)
DROP POLICY IF EXISTS collections_select_team ON public.collections;
CREATE POLICY collections_select_team ON public.collections FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- FIN v5
-- ============================================================
