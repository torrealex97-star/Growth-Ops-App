-- ============================================================
-- MIGRACIÓN v9 — Socios y reparto de beneficios
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.partners (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  user_id        UUID REFERENCES public.users(id),
  profit_percent NUMERIC(5,2) NOT NULL DEFAULT 0,  -- % del beneficio neto (tras TODOS los gastos)
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS partners_updated_at ON public.partners;
CREATE TRIGGER partners_updated_at BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partners_select ON public.partners;
CREATE POLICY partners_select ON public.partners FOR SELECT USING (get_my_role() IN ('admin','director','manager'));
DROP POLICY IF EXISTS partners_modify ON public.partners;
CREATE POLICY partners_modify ON public.partners FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Seed de los 3 socios (solo si la tabla está vacía)
INSERT INTO public.partners (name, profit_percent)
SELECT * FROM (VALUES
  ('Adrián Martínez', 55.00),
  ('Alex', 30.00),
  ('Jesús Peña', 15.00)
) AS v(name, profit_percent)
WHERE NOT EXISTS (SELECT 1 FROM public.partners);

-- ============================================================
-- FIN v9
-- ============================================================
