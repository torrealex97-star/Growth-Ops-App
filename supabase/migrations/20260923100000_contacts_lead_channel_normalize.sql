-- Normalización de `contacts.lead_channel` (2026-09-23).
--
-- Problema (verificado en producción): el mismo concepto llega con variantes de
-- mayúsculas/espacios ("Formulario VSL - Automaticamente" vs
-- "formulario vsl - automaticamente"), y cualquier desglose por canal sobre-agrupa.
--
-- Estrategia en una migración:
--   1) Función IMMUTABLE que define la forma canónica: trim + colapsar espacios + minúsculas.
--      Vacío tras normalizar → NULL (un vacío no es un valor).
--   2) UPDATE de datos existentes con esa función.
--   3) Trigger BEFORE INSERT/UPDATE que normaliza al vuelo (la app no necesita cambios).
--   4) CHECK final: lo persistido debe ser idéntico a su forma canónica —
--      imposibilita nuevos duplicados de caso/espacios aunque se escriba por fuera de la app.

-- ============ 1) Función canónica ============
create or replace function public.contacts_normalize_lead_channel(p_valor text)
returns text
language sql
immutable
as $$
  select case
    when p_valor is null then null
    else nullif(
      lower(btrim(regexp_replace(p_valor, '\s+', ' ', 'g'))),
      ''
    )
  end
$$;

-- ============ 2) UPDATE de datos existentes ============
update public.contacts
   set lead_channel = public.contacts_normalize_lead_channel(lead_channel)
 where lead_channel is not null
   and lead_channel <> public.contacts_normalize_lead_channel(lead_channel);

-- ============ 3) Trigger: normaliza al vuelo ============
create or replace function public.contacts_normalize_lead_channel_trigger()
returns trigger
language plpgsql
as $$
begin
  new.lead_channel := public.contacts_normalize_lead_channel(new.lead_channel);
  return new;
end;
$$;

drop trigger if exists contacts_normalize_lead_channel_trg on public.contacts;
create trigger contacts_normalize_lead_channel_trg
  before insert or update of lead_channel on public.contacts
  for each row
  execute function public.contacts_normalize_lead_channel_trigger();

-- ============ 4) CHECK: lo persistido debe ser canónico ============
alter table public.contacts
  add constraint contacts_lead_channel_canonical_chk
  check (
    lead_channel is null
    or lead_channel = public.contacts_normalize_lead_channel(lead_channel)
  );
