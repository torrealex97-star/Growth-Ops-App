-- ─────────────────────────────────────────────────────────────────────────────
-- CIERRA UNA ESCALADA DE PRIVILEGIOS: un admin de subcuenta podía hacerse super_admin.
--
-- EL AGUJERO, exactamente. `is_super_admin()` es un flag de PLATAFORMA: basta UNA fila en
-- tenant_members con role='super_admin' —en cualquier subcuenta— para que devuelva true, y todas
-- las políticas de aislamiento de las tablas de negocio terminan en `OR public.is_super_admin()`.
-- La política de escritura de tenant_members, en cambio, solo exigía `is_tenant_admin(tenant_id)`:
-- el admin de una subcuenta de cliente podía insertar (o ascender) una fila con role='super_admin'
-- EN SU PROPIA subcuenta y, con eso, leer y escribir los datos de TODAS las demás.
--
-- Un admin de cliente es un usuario normal de la plataforma: no debería poder concederse nada que
-- no tenga. Tras esta migración:
--   · Crear o ascender a super_admin exige YA ser super_admin.
--   · Tocar (modificar o borrar) una fila que YA es super_admin exige también ser super_admin, para
--     que un admin de subcuenta no pueda degradar ni borrar al dueño de la plataforma.
--   · Todo lo demás (invitar, cambiar entre admin/member, quitar a alguien) sigue igual.
--
-- El camino service-role (el aprovisionador de subcuentas) salta RLS por diseño; ahí el límite lo
-- pone `validateMemberRole` en lib/tenants/blueprint.ts, que rechaza 'super_admin' y está cubierto
-- por tests. Esta migración cierra el camino que sí está expuesto al cliente.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS tenant_members_modify ON public.tenant_members;
CREATE POLICY tenant_members_modify ON public.tenant_members FOR ALL TO authenticated
USING (
  public.is_tenant_admin(tenant_id)
  AND (role <> 'super_admin' OR public.is_super_admin())
)
WITH CHECK (
  public.is_tenant_admin(tenant_id)
  AND (role <> 'super_admin' OR public.is_super_admin())
);
