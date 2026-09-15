-- LA LECTURA DE LAS FACTURAS DE COMISIÓN, ACOTADA A LA SUBCUENTA.
--
-- Continúa 20260915130000_rol_acotado_por_subcuenta.sql, que cerró las ESCRITURAS. Va en su propio
-- fichero porque aquella ya estaba aplicada en producción: ampliarla habría dejado el fichero
-- describiendo algo distinto de lo que la base tiene.
--
-- POR QUÉ SOLO ESTA TABLA. Se revisaron las políticas de SELECT de las tablas de dinero una por una,
-- porque "cerrar la lectura a los miembros" y "cerrar una escalada" no son lo mismo y confundirlos
-- mete una decisión de producto disfrazada de corrección de seguridad:
--
--   sales, collections, payment_plans → `get_my_role() IS NOT NULL`: las lee cualquiera del equipo.
--   expenses  → ('admin','director','manager')
--   contracts → (…,'manager','gestoria','csm')
--     En todas ellas un rol recortado a `manager` SIGUE leyendo, así que restringir no cerraría ninguna
--     escalada: inventaría una regla. No se tocan. Además, la visibilidad de las ventas ajenas dentro
--     del equipo es INTENCIONAL y está decidida por el dueño del negocio (ver docs/ADR-ventas-visibilidad).
--   commissions → solo las propias (`user_id = auth.uid()`). Nada que cerrar.
--
--   commission_invoices → `user_id = auth.uid() OR public.is_admin_or_director()`.
--     AQUÍ SÍ. Esa segunda mitad lee el rol funcional GLOBAL, así que alguien con rol `director` en su
--     subcuenta, invitado a otra solo como miembro, leía las facturas de comisión de TODO el equipo de
--     esa otra subcuenta: cuánto cobra cada persona del cliente. Eso no lo concede su membresía, se lo
--     concede un rol que ejerce en otro sitio.
--
-- Su propia factura la sigue viendo cada uno: la condición mantiene `user_id = auth.uid()`, y el
-- guardián solo quita lo que el `OR is_admin_or_director()` añadía de más.
--
-- ALCANCE COMPROBADO CONTRA PRODUCCIÓN antes de escribir esto: de las 4 membresías existentes, la única
-- `member` pertenece a alguien con rol funcional `closer` (no elevado), así que hoy esto NO cambia el
-- acceso de nadie. Es preventivo: empieza a importar cuando entre el primer cliente.

drop policy if exists commission_invoices_rol_acotado_select on public.commission_invoices;
create policy commission_invoices_rol_acotado_select on public.commission_invoices
  as restrictive for select
  using (user_id = auth.uid() or not public.rol_recortado_en(tenant_id));
