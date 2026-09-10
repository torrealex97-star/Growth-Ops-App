-- v36 — Extras/bonus de productos (llamada 1-1, Honey, +1 mes…) que se incluyen en una venta.
--   · product_extras: catálogo editable (admin/director).
--   · sales.extras: array de nombres de extras incluidos en esa venta (para contrato y export).
--   Requiere is_admin_or_director() y handle_updated_at(). Idempotente.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.product_extras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS product_extras_updated_at ON public.product_extras;
CREATE TRIGGER product_extras_updated_at
  BEFORE UPDATE ON public.product_extras
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.product_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_extras_select ON public.product_extras;
CREATE POLICY product_extras_select ON public.product_extras FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS product_extras_modify ON public.product_extras;
CREATE POLICY product_extras_modify ON public.product_extras FOR ALL
  USING (public.is_admin_or_director()) WITH CHECK (public.is_admin_or_director());

-- Extras incluidos en la venta (nombres, denormalizado para contrato/export).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS extras TEXT[];
