-- Verificación de F01 (el colaborador no lee los datos del equipo). SOLO LECTURA: cada bloque
-- abre una transacción, se pone en el papel `authenticated` con los claims de un usuario real y
-- termina en ROLLBACK. Devuelve RECUENTOS, nunca filas ni identidades.
--
-- Cómo se usa:
--   · ANTES de aplicar la migración, el bloque 1 debe mostrar «visibles = total» (el fallo).
--   · DESPUÉS, el bloque 1 debe mostrar «visibles ≈ suyas» (0 si no tiene nada atribuido), y el
--     bloque 2 debe seguir mostrando «visibles = total» (un admin NO pierde nada).
-- Ejecutar cada bloque por separado: el cliente solo devuelve el resultado de la última sentencia.

-- ── BLOQUE 1: un colaborador ─────────────────────────────────────────────────────────────────
begin;
select set_config('x.t_sales',(select count(*) from public.sales)::text,true),
       set_config('x.t_appts',(select count(*) from public.appointments)::text,true),
       set_config('x.t_contacts',(select count(*) from public.contacts)::text,true),
       set_config('x.t_cols',(select count(*) from public.collections)::text,true),
       set_config('x.t_stripe',(select count(*) from public.stripe_payments)::text,true),
       set_config('x.t_stripe_c',(select count(*) from public.stripe_customers)::text,true),
       set_config('x.t_attr',(select count(*) from public.contact_attributions)::text,true);
select set_config('request.jwt.claims', json_build_object('sub',
  (select u.id from public.users u join public.roles r on r.id=u.role_id where r.key='affiliate' order by u.id limit 1),
  'role','authenticated')::text, true);
set local role authenticated;
select 'colaborador' as quien,
  (select count(*) from public.sales) as ventas_visibles, current_setting('x.t_sales') as ventas_total,
  (select count(*) from public.sales where public.is_my_collaborator_sale(id)) as ventas_suyas,
  (select count(*) from public.appointments) as citas_visibles, current_setting('x.t_appts') as citas_total,
  (select count(*) from public.contacts) as contactos_visibles, current_setting('x.t_contacts') as contactos_total,
  (select count(*) from public.contacts where public.is_my_collaborator_row(id)) as contactos_suyos,
  (select count(*) from public.collections) as cobros_visibles, current_setting('x.t_cols') as cobros_total,
  (select count(*) from public.stripe_payments) as stripe_pagos_visibles, current_setting('x.t_stripe') as stripe_pagos_total,
  (select count(*) from public.stripe_customers) as stripe_clientes_visibles, current_setting('x.t_stripe_c') as stripe_clientes_total,
  (select count(*) from public.contact_attributions) as atribuciones_visibles, current_setting('x.t_attr') as atribuciones_total;
rollback;

-- ── BLOQUE 2: NO-REGRESIÓN, un admin sigue viéndolo todo ─────────────────────────────────────
begin;
select set_config('x.t_sales',(select count(*) from public.sales)::text,true),
       set_config('x.t_appts',(select count(*) from public.appointments)::text,true),
       set_config('x.t_contacts',(select count(*) from public.contacts)::text,true),
       set_config('x.t_cols',(select count(*) from public.collections)::text,true),
       set_config('x.t_stripe',(select count(*) from public.stripe_payments)::text,true);
select set_config('request.jwt.claims', json_build_object('sub',
  (select u.id from public.users u join public.roles r on r.id=u.role_id where r.key='admin' order by u.id limit 1),
  'role','authenticated')::text, true);
set local role authenticated;
select 'admin' as quien,
  (select count(*) from public.sales) as ventas_visibles, current_setting('x.t_sales') as ventas_total,
  (select count(*) from public.appointments) as citas_visibles, current_setting('x.t_appts') as citas_total,
  (select count(*) from public.contacts) as contactos_visibles, current_setting('x.t_contacts') as contactos_total,
  (select count(*) from public.collections) as cobros_visibles, current_setting('x.t_cols') as cobros_total,
  (select count(*) from public.stripe_payments) as stripe_pagos_visibles, current_setting('x.t_stripe') as stripe_pagos_total;
rollback;
