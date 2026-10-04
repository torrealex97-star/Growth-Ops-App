-- Vincula (opcionalmente) un socio a su usuario de login, para que /finanzas/socios pueda
-- reconocer "este socio soy yo" y dejarle ver sus ganancias reales sin necesidad de rol de
-- dirección (ver lib/finance/socios.ts y docs/MONEY.md D9 — reparto de socios ≠ comisión de venta).
-- Nullable a propósito: un socio sin login en la app sigue pudiendo tener su % configurado.
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS partners_user_id_idx ON public.partners(user_id) WHERE user_id IS NOT NULL;
