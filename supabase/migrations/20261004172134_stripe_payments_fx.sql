-- F04 (DASHBOARD_AUDIT.md) · MONEY D2: un importe en otra moneda no se suma como si fuera EUR.
-- En producción hay 1 pago en USD (300) que el cash canónico sumaba como 300 €.
--
-- El importe se conserva en su moneda original (`amount`, `currency`); junto a él se guarda el tipo
-- de cambio aplicado y SU FECHA (D2: «guarda junto al importe convertido el tipo aplicado y su
-- fecha»). Tipo = EUR por 1 unidad de la moneda del pago, publicado por el BCE para la fecha del
-- cobro (si fue festivo/fin de semana, el último día hábil anterior: `fx_rate_date` lo dice).
-- NULL = sin tipo conocido: ese pago se reporta como «no convertido», no se cuenta como EUR.
--
-- Aditivo (dos columnas nullable): no reescribe filas ni cambia RLS.

ALTER TABLE public.stripe_payments
  ADD COLUMN IF NOT EXISTS fx_rate_to_eur numeric(18, 8),
  ADD COLUMN IF NOT EXISTS fx_rate_date date;

COMMENT ON COLUMN public.stripe_payments.fx_rate_to_eur IS
  'EUR por 1 unidad de `currency` (BCE, a la fecha del cobro). NULL = sin tipo; pagos no-EUR sin tipo se reportan como no convertidos (MONEY D2).';
COMMENT ON COLUMN public.stripe_payments.fx_rate_date IS
  'Fecha de publicación del tipo aplicado (puede ser anterior al cobro si ese día no hubo cotización).';
