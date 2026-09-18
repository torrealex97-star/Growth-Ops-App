-- Fase multitenant: ARCHIVAR subcuentas desde la cuenta madre.
--
-- 'archived' es un tercer estado de tenants.status, distinto de 'suspended':
--   * suspended  = pausa temporal (p. ej. cliente que deja de pagar): se reactiva cuando vuelva.
--   * archived   = relación comercial terminada: se conserva TODO (contacts, sales, payments,
--                  contracts, audit…) para facturación y auditoría, pero la subcuenta desaparece
--                  de las pantallas operativas y se bloquea de entrada en todos los caminos.
--
-- No hace falta tocar los gates uno a uno: TODOS comprueban `status = 'active'` o `!= 'active'`
-- (requireTenant para las 158 rutas API, login, webhooks de Calendly/GHL/Stripe/onboarding/contrato,
-- los 12 crons, la ingesta del pixel y el OAuth de Google), así que una subcuenta archivada queda
-- cerrada en cada uno de ellos por la misma comprobación que ya bloquea a las suspendidas.
-- La única vía para volver a usarla es la acción "restaurar" de la pantalla de subcuentas (super
-- admin de plataforma), que escribe de nuevo 'active' con auditoría old→new.
--
-- La migración es idempotente (IF EXISTS) para poder reaplicarse sin daño.

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('active', 'suspended', 'archived'));
