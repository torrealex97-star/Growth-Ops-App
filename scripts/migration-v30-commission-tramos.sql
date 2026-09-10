-- v30 — Enlaza las reglas de comisión con los Tramos/niveles de gamificación (sales_tramos).
--   · commission_rules.tramo_id (opcional): si está definido, el % de la regla se aplica cuando
--     el rep tiene ESE tramo desbloqueado (según sales_tramos + sales_tramos_config), en vez de
--     seleccionarse por el tramo de cash collected (min_cash/max_cash).
--   · Idempotente. Requiere que exista la tabla public.sales_tramos (migration-v26-tramos.sql).
SET check_function_bodies = false;

ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS tramo_id UUID REFERENCES public.sales_tramos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS commission_rules_tramo_id_idx ON public.commission_rules(tramo_id);
