-- v28 — Nombre legible de la cuenta publicitaria de Meta.
-- Guarda el nombre de la cuenta (además del act_XXX) para poder filtrar el panel
-- de Campañas por NOMBRE de cuenta en lugar de por el id numérico.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_name TEXT; -- nombre de la cuenta de Meta
