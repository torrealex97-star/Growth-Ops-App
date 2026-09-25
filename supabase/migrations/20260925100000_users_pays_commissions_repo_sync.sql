-- La columna `pays_commissions` ya existía en producción (aplicada directo, sin migración en el
-- repo — patrón ya visto antes en este proyecto). Esta migración solo pone el repo al día con lo
-- que ya hay en la base: IF NOT EXISTS para que sea un no-op donde ya exista.
alter table public.users
  add column if not exists pays_commissions boolean not null default true;

comment on column public.users.pays_commissions is
  'Si es false, este usuario NUNCA recibe comisión de closer/setter/afiliado (p.ej. un socio con reparto de beneficio aparte, en vez de comisión de venta). Lo aplican lib/commissions/calculator.ts y el Dashboard de Comisiones.';
