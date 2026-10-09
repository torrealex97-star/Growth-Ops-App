-- DATA REPAIR: enlaza ventas históricas con su agenda únicamente cuando existe evidencia fuerte.
--
-- Regla conservadora e idempotente:
-- - mismo tenant y contacto;
-- - cita dentro de los 90 días anteriores (incluye el día de venta);
-- - exactamente una cita con asistencia (`show`/`attended`).
--
-- No se tocan ventas ya enlazadas ni casos con más de un show: esos requieren decisión humana.

with unique_attended as (
  select
    s.id as sale_id,
    (array_agg(a.id order by a.appointment_datetime desc))[1] as appointment_id
  from public.sales s
  join public.appointments a
    on a.tenant_id = s.tenant_id
   and a.contact_id = s.contact_id
   and a.appointment_datetime >= s.sale_date::timestamp - interval '90 days'
   and a.appointment_datetime < s.sale_date::timestamp + interval '1 day'
   and a.status in ('show', 'attended')
  where s.appointment_id is null
    and s.status = 'active'
  group by s.id
  having count(*) = 1
)
update public.sales s
set appointment_id = u.appointment_id,
    updated_at = now()
from unique_attended u
where s.id = u.sale_id
  and s.appointment_id is null;
