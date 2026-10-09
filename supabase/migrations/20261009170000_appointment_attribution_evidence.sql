-- EXPAND + BACKFILL: evidencia de atribución por agenda.
--
-- No convierte last-touch en second-touch. `attribution_second` permanece NULL salvo que el
-- proveedor entregue explícitamente una segunda interacción cronológica. Los snapshots excluyen
-- IP y user-agent; el raw original conserva la evidencia reprocesable según su política de retención.

alter table public.appointments
  add column if not exists attribution_first jsonb,
  add column if not exists attribution_second jsonb,
  add column if not exists attribution_last jsonb,
  add column if not exists attribution_booking jsonb,
  add column if not exists attribution_status text not null default 'none';

alter table public.appointments
  drop constraint if exists appointments_attribution_status_check;
alter table public.appointments
  add constraint appointments_attribution_status_check
  check (attribution_status in ('none', 'partial', 'complete'));

-- GHL: conserva bloques first/last reales y elimina campos personales innecesarios.
update public.appointments
set
  attribution_first = coalesce(raw_payload -> 'attributionSource', raw_payload -> 'firstAttributionSource')
    - 'ip' - 'userAgent',
  attribution_second = (raw_payload -> 'secondAttributionSource') - 'ip' - 'userAgent',
  attribution_last = (raw_payload -> 'lastAttributionSource') - 'ip' - 'userAgent',
  attribution_status = case
    when jsonb_path_exists(coalesce(raw_payload -> 'secondAttributionSource', '{}'::jsonb), '$.* ? (@ != null && @ != "")') then 'complete'
    when jsonb_path_exists(coalesce(raw_payload -> 'attributionSource', raw_payload -> 'firstAttributionSource', raw_payload -> 'lastAttributionSource', '{}'::jsonb), '$.* ? (@ != null && @ != "")') then 'partial'
    else 'none'
  end
where external_source = 'ghl'
  and raw_payload is not null;

-- Calendly webhook guarda body.payload; la sync por pull guarda {event, invitee}.
update public.appointments
set
  attribution_booking = coalesce(
    raw_payload #> '{payload,tracking}',
    raw_payload #> '{invitee,tracking}',
    raw_payload -> 'tracking'
  ),
  attribution_status = case
    when jsonb_path_exists(
      coalesce(raw_payload #> '{payload,tracking}', raw_payload #> '{invitee,tracking}', raw_payload -> 'tracking', '{}'::jsonb),
      '$.* ? (@ != null && @ != "")'
    ) then 'partial'
    else 'none'
  end
where external_source = 'calendly'
  and raw_payload is not null;

comment on column public.appointments.attribution_first is
  'Primer toque declarado por el proveedor; NULL cuando no existe evidencia.';
comment on column public.appointments.attribution_second is
  'Segunda interacción cronológica explícita; nunca se infiere a partir del last-touch.';
comment on column public.appointments.attribution_last is
  'Último toque declarado por el proveedor.';
comment on column public.appointments.attribution_booking is
  'Atribución observada en el momento de reservar la agenda.';
comment on column public.appointments.attribution_status is
  'Cobertura de evidencia: none, partial o complete.';
