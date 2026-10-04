-- SEGURIDAD P0 — resto de F01 (ver 20261003082207 y 20261003122304, ya aplicadas en producción).
--
-- QUÉ QUEDABA. Esas dos migraciones cerraron sales, appointments, contacts, collections,
-- contact_attributions, activities y stripe_payments para quien no es liderazgo. `stripe_customers`
-- se quedó fuera y SIGUE siendo legible por cualquier miembro de la subcuenta: medido en
-- producción el 4-oct con perfiles que son miembros de WDC, un colaborador y el setter leían
-- 32 de 32 clientes de Stripe (correo y nombre), con 0 ventas, 0 citas y 0 contactos visibles.
--
-- QUÉ HACE. Misma forma que stripe_payments: liderazgo conserva todo; el resto solo ve el cliente
-- de Stripe cuyo CONTACTO ya puede ver. Se apoya en `contacts` con la RLS del propio usuario (una
-- subconsulta dentro de una política se evalúa con los permisos de quien pregunta), así que no
-- duplica la regla de atribución: la hereda de `contacts_select_scope`. Un cliente de Stripe sin
-- contacto enlazado (2 hoy) solo lo ve liderazgo: es reconciliación pendiente, no dato de un
-- vendedor concreto.
--
-- QUÉ NO TOCA. `stripe_customers_all` (solo admin/director) ni `stripe_customers_tenant_isolation`
-- (restrictiva, ya correcta). Solo cambia la política de lectura abierta a todos los miembros.

ALTER POLICY stripe_customers_select_team ON public.stripe_customers
  USING (
    is_super_admin()
    OR (
      tenant_id IN (SELECT auth_tenant_ids())
      AND (
        is_admin_or_director()
        OR is_team_scope_allowed()
        OR (
          contact_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = stripe_customers.contact_id)
        )
      )
    )
  );
