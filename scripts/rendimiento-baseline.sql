-- S0.6 — Baseline de rendimiento. Consultas de SOLO LECTURA usadas en docs/S0-6-RENDIMIENTO-FRONTEND.md.
-- Repetirlas tras cualquier cambio dice si la cifra mejoró o empeoró. No modifican nada.

-- 1) Las lecturas de la APP que más tiempo suman.
--    Van envueltas en `pgrst_source` porque llegan por PostgREST; sin ese filtro el ranking se llena
--    de consultas internas del panel de Supabase (pg_timezone_names, catálogo de extensiones…).
select
  round(total_exec_time::numeric, 0) as ms_total,
  calls,
  round(mean_exec_time::numeric, 1) as ms_medio,
  round(max_exec_time::numeric, 0) as ms_max,
  substring(regexp_replace(query, '\s+', ' ', 'g') from 'FROM "public"\."[a-z_]+"') as tabla
from pg_stat_statements
where query like '%pgrst_source%'
order by total_exec_time desc
limit 15;

-- 2) EL COSTE DE LAS REGLAS DE ACCESO, en la misma consulta y el mismo momento.
--    Cambia el uuid del usuario por uno real de la subcuenta que quieras medir.
--    (a) Con las reglas, tal y como la ejecuta la app:
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
explain (analyze, buffers)
select id, appointment_datetime, status, contact_id
from appointments
where tenant_id = '00000000-0000-0000-0000-000000000000'
order by appointment_datetime desc
limit 100;
rollback;

--    (b) Sin ellas (rol de servicio). La diferencia entre (a) y (b) es lo que cuestan las políticas.
explain (analyze, buffers)
select id, appointment_datetime, status, contact_id
from appointments
where tenant_id = '00000000-0000-0000-0000-000000000000'
order by appointment_datetime desc
limit 100;

-- 3) Índices sin uso registrado. OJO: en una tabla casi vacía el índice no se usa porque no hay
--    datos, no porque sobre. No borrar nada sin volumen real.
select
  s.relname as tabla,
  s.indexrelname as indice,
  s.idx_scan as usos,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as tamano
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
  and s.idx_scan = 0
  and not i.indisunique
order by pg_relation_size(s.indexrelid) desc;

-- 4) Claves foráneas sin índice: cada borrado y cada join en esa dirección las paga.
select
  c.conrelid::regclass as tabla,
  a.attname as columna,
  c.confrelid::regclass as apunta_a
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f'
  and c.connamespace = 'public'::regnamespace
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
  )
order by 1;

-- 5) Políticas solapadas: varias permisivas sobre la misma tabla y operación se evalúan TODAS.
--    `cmd = 'ALL'` cubre las cuatro operaciones, así que hay que expandirlo: sin eso, una política
--    ALL y otra SELECT sobre la misma tabla parecen no solaparse, y sí lo hacen en cada lectura.
with expandidas as (
  select
    tablename,
    unnest(case when cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[cmd] end) as accion,
    policyname
  from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE'
)
select tablename, accion, count(*) as politicas, string_agg(policyname, ', ') as cuales
from expandidas
group by 1, 2
having count(*) > 1
order by 3 desc, 1;
