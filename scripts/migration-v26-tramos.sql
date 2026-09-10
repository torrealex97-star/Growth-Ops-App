-- v26 — Tramos (niveles de desbloqueo) de ventas para el dashboard del equipo.
--   · El admin define varios TRAMOS con nombre y umbral. El umbral se mide por
--     Nº DE VENTAS COMPLETADAS (todo cuenta salvo reservas abiertas) o por
--     CASH COLLECTED, según el modo global elegido.
--   · Cada usuario ve en su dashboard su progreso hacia el siguiente tramo y,
--     al alcanzarlo, se celebra con confeti (nivel desbloqueado).
-- Requiere helper existente: handle_updated_at(), get_my_role(), is_admin_or_director().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.sales_tramos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  threshold   NUMERIC(12,2) NOT NULL,   -- umbral: nº de ventas o € de cash collected
  emoji       TEXT,                     -- emoji del nivel (opcional)
  color       TEXT,                     -- color hex del nivel (opcional)
  reward      TEXT,                     -- recompensa/nota del nivel (opcional)
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configuración global (singleton, id=1): modo de medida y periodo.
CREATE TABLE IF NOT EXISTS public.sales_tramos_config (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  metric     TEXT NOT NULL DEFAULT 'sales' CHECK (metric IN ('sales','cash_collected')),
  period     TEXT NOT NULL DEFAULT 'month' CHECK (period IN ('month','all')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.sales_tramos_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS sales_tramos_updated_at ON public.sales_tramos;
CREATE TRIGGER sales_tramos_updated_at BEFORE UPDATE ON public.sales_tramos
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS sales_tramos_config_updated_at ON public.sales_tramos_config;
CREATE TRIGGER sales_tramos_config_updated_at BEFORE UPDATE ON public.sales_tramos_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: cualquier miembro del equipo LEE (ve su progreso); solo admin/director gestionan.
ALTER TABLE public.sales_tramos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_tramos_select ON public.sales_tramos;
CREATE POLICY sales_tramos_select ON public.sales_tramos
  FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS sales_tramos_modify ON public.sales_tramos;
CREATE POLICY sales_tramos_modify ON public.sales_tramos
  FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

ALTER TABLE public.sales_tramos_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_tramos_config_select ON public.sales_tramos_config;
CREATE POLICY sales_tramos_config_select ON public.sales_tramos_config
  FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS sales_tramos_config_modify ON public.sales_tramos_config;
CREATE POLICY sales_tramos_config_modify ON public.sales_tramos_config
  FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Seed de ejemplo (descomenta y ajusta si quieres arrancar con tramos por defecto):
-- INSERT INTO public.sales_tramos (name, threshold, emoji, sort_order) VALUES
--   ('Nivel 1', 3,  '🥉', 1),
--   ('Nivel 2', 6,  '🥈', 2),
--   ('Nivel 3', 10, '🥇', 3),
--   ('Leyenda', 15, '🏆', 4);
