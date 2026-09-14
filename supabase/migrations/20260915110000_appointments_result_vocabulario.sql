-- Vocabulario cerrado para el desenlace de una llamada. Lo declara el negocio (venta, seguimiento,
-- no interesado, no cualificado, no-show, otro); `result` era texto libre y estaba a 0/559, así que
-- sin esto el primer typo del primer closer crearía una categoría fantasma que nadie vería.
--
-- `null` sigue permitido: una cita sin marcar no es una cita inválida, y distinguir "sin marcar" de
-- "marcado como otro" es precisamente lo que permite decir NOT_TRACKED en vez de 0%.
alter table public.appointments drop constraint if exists appointments_result_check;
alter table public.appointments
  add constraint appointments_result_check
  check (result is null or result in ('venta', 'seguimiento', 'no_interesado', 'no_cualificado', 'no_show', 'otro'));

-- El dashboard pregunta "de las citas de este rango, cuántas con oferta / con este resultado".
-- Parcial sobre lo marcado: mientras casi todo esté a null, el índice se queda pequeño y sirve además
-- para resolver "desde cuándo se mide" sin recorrer la tabla.
create index if not exists appointments_tenant_medidas_idx
  on public.appointments (tenant_id, appointment_datetime desc)
  where offered is not null or result is not null;
