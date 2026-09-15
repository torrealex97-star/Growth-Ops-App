-- EL ROL DE ADMINISTRACIÓN, ACOTADO A LA SUBCUENTA — mitad de base de datos.
--
-- EL AGUJERO. El modelo tiene dos ejes de rol y solo uno está acotado por subcuenta:
--
--   · `users.role_id` → rol FUNCIONAL (admin, director, closer, marketing…). Es GLOBAL: una fila por
--     identidad, la misma en todas las subcuentas. Es el que leen `get_my_role()` y
--     `is_admin_or_director()`, y por tanto con el que deciden casi todas las políticas.
--   · `tenant_members.role` → rol de TENENCIA ('super_admin' | 'admin' | 'member'). Sí es por subcuenta.
--
-- El aislamiento RESTRICTIVE limita a alguien a las subcuentas de las que es miembro, pero DENTRO de
-- cada una le aplica su rol funcional global. Resultado:
--
--   Alguien con rol funcional `director`, invitado a la subcuenta de otro cliente como simple `member`,
--   ejerce de director de ese cliente: `is_admin_or_director()` devuelve true y las políticas de
--   escritura le abren gastos y contratos.
--
-- Hoy es latente (las dos subcuentas son del mismo dueño, y quien crea una recibe `super_admin`).
-- Deja de serlo el día que entre un cliente.
--
-- POR QUÉ ESTE GUARDIÁN Y NO REESCRIBIR LAS POLÍTICAS. La corrección "de libro" sería pasar el
-- tenant_id a la comprobación de rol en cada política — `rol_en(tenant_id) IN ('admin','director')` —
-- pero eso son ~200 políticas con lógica de negocio real dentro, reescritas a mano y sin poder
-- probarlas contra los datos. El riesgo de romper accesos legítimos es mayor que el agujero que cierra.
--
-- En su lugar se añade UNA política RESTRICTIVE que deniega EXACTAMENTE el caso de escalada y nada más.
-- Para cualquiera que no esté en ese caso, la función devuelve false y la política pasa: cero cambio de
-- comportamiento. Es la propiedad que hace que esto se pueda aplicar sin auditar 200 políticas.
--
-- La mitad de aplicación ya está hecha y es la que cubre las ~118 rutas que usan service_role (donde
-- RLS no interviene): ver lib/auth/rol-efectivo.ts y lib/auth/requireTenant.ts.

-- ---------------------------------------------------------------------------------------------
-- 1) ¿Está el rol elevado de este llamante recortado en ESTA subcuenta?
--
-- Devuelve true SOLO cuando se dan las tres cosas a la vez: el rol funcional concede administración,
-- no es super_admin de plataforma, y su membresía en esta subcuenta no es de administración.
-- ---------------------------------------------------------------------------------------------

create or replace function public.rol_recortado_en(check_tenant_id uuid)
returns boolean
language sql
stable
security definer
-- search_path fijo: sin él, quien pueda crear objetos en un esquema anterior en su search_path podría
-- suplantar `public.users` dentro de la función (misma razón que en fix_rls_p0_round2).
set search_path = public
as $$
  select
    -- El rol funcional concede administración…
    public.get_my_role() in ('admin', 'director')
    -- …no es super_admin de plataforma (ese administra todas las subcuentas por definición)…
    and not public.is_super_admin()
    -- …y en ESTA subcuenta no tiene membresía de administración.
    and not exists (
      select 1 from public.tenant_members
      where user_id = auth.uid()
        and tenant_id = check_tenant_id
        and role in ('admin', 'super_admin')
    );
$$;

-- El rol funcional YA ACOTADO, para lo que necesite decidir con él en base.
-- `manager` y no NULL: dejar sin rol a alguien a quien se le ha dado acceso convierte una corrección de
-- seguridad en una avería. `manager` existe en el modelo, ve casi todo y NO pasa is_admin_or_director().
create or replace function public.rol_en_tenant(check_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.rol_recortado_en(check_tenant_id) then 'manager'
    else public.get_my_role()
  end;
$$;

-- Ni anon ni PUBLIC tienen nada que hacer con esto.
revoke execute on function public.rol_recortado_en(uuid) from public, anon;
grant execute on function public.rol_recortado_en(uuid) to authenticated;
revoke execute on function public.rol_en_tenant(uuid) from public, anon;
grant execute on function public.rol_en_tenant(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2) EL GUARDIÁN. Solo INSERT / UPDATE / DELETE, y solo donde una escritura de administración importa.
--
-- No se toca el SELECT a propósito: a esa persona SÍ se le ha dado acceso a la subcuenta, y decidir si
-- un `member` puede ver las finanzas es una decisión de producto, no una corrección de seguridad. Lo que
-- aquí se cierra es que ESCRIBA como si administrara.
--
-- Las tablas elegidas son las que hoy reciben escrituras directas desde el navegador con la sesión del
-- usuario (donde RLS es la única barrera): `expenses` (app/[tenant]/finanzas/gastos-facturas/gastos) y
-- `contracts` (app/[tenant]/contratos). Las demás escriben por rutas con service_role, que ya quedan
-- cubiertas por la mitad de aplicación.
--
-- Se añaden también sobre las tablas de dinero aunque hoy solo se escriban por service_role: si mañana
-- alguien añade una escritura directa, el guardián ya está puesto.
-- ---------------------------------------------------------------------------------------------

-- Postgres no admite `for insert, update, delete` en una sola política, así que van tres por tabla.
-- Y NO se crea ninguna para SELECT: eso restringiría la lectura, que es justo lo que no se toca.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array[
    'expenses', 'contracts', 'sales', 'collections', 'refunds',
    'commissions', 'commission_invoices', 'payment_plans'
  ]
  loop
    foreach op in array array['insert', 'update', 'delete']
    loop
      execute format('drop policy if exists %I on public.%I', t || '_rol_acotado_' || op, t);
      if op = 'insert' then
        -- INSERT solo admite WITH CHECK.
        execute format(
          'create policy %I on public.%I as restrictive for insert with check (not public.rol_recortado_en(tenant_id))',
          t || '_rol_acotado_insert', t
        );
      elsif op = 'update' then
        execute format(
          'create policy %I on public.%I as restrictive for update using (not public.rol_recortado_en(tenant_id)) with check (not public.rol_recortado_en(tenant_id))',
          t || '_rol_acotado_update', t
        );
      else
        -- DELETE solo admite USING.
        execute format(
          'create policy %I on public.%I as restrictive for delete using (not public.rol_recortado_en(tenant_id))',
          t || '_rol_acotado_delete', t
        );
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3) LA LECTURA: solo donde de verdad hay escalada, y no como política nueva de producto.
--
-- Se revisaron las políticas de SELECT de las tablas de dinero una por una, porque "cerrar la lectura
-- a los miembros" y "cerrar una escalada" no son lo mismo, y confundirlos habría metido una decisión de
-- producto disfrazada de corrección de seguridad. Lo que hay:
--
--   sales, collections, payment_plans → `get_my_role() IS NOT NULL`: las lee cualquiera del equipo.
--   expenses  → ('admin','director','manager')  ·  contracts → (…, 'manager', 'gestoria', 'csm')
--     En todas ellas, un rol recortado a `manager` SIGUE leyendo. Añadir aquí una restricción no
--     cerraría ninguna escalada: inventaría una regla nueva. NO se toca.
--   commissions → solo las propias (`user_id = auth.uid()`). Nada que cerrar.
--
--   commission_invoices → `user_id = auth.uid() OR public.is_admin_or_director()`.
--     AQUÍ SÍ. `is_admin_or_director()` lee el rol funcional GLOBAL, así que alguien con rol `director`
--     en su subcuenta, invitado a otra solo como miembro, lee las facturas de comisión de TODO el
--     equipo de esa otra subcuenta: cuánto cobra cada persona del cliente. Eso no lo concede su
--     membresía, se lo concede un rol que ejerce en otro sitio. Es la misma escalada que las
--     escrituras de arriba, y se cierra igual.
--
--     Su propia factura la sigue viendo: el guardián solo quita lo que el `OR is_admin_or_director()`
--     añadía de más. Por eso la condición incluye `user_id = auth.uid()`.
-- ---------------------------------------------------------------------------------------------

drop policy if exists commission_invoices_rol_acotado_select on public.commission_invoices;
create policy commission_invoices_rol_acotado_select on public.commission_invoices
  as restrictive for select
  using (user_id = auth.uid() or not public.rol_recortado_en(tenant_id));
