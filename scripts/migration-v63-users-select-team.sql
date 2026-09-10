-- v63: la política "users_select" solo permitía ver la propia fila (o todas si eras
-- admin/director). Cualquier setter/closer/etc. que no fuera admin/director no podía ver
-- a sus compañeros, así que los selectores de closer/setter/afiliado al marcar una venta
-- (app/evergreen/sales/[id], sales/page.tsx, sales/new/page.tsx) le salían casi vacíos
-- (bug reportado: "No sale [tenant] al elegir closer"). Se amplía igual que ya está
-- resuelto para `contacts_select_team`: cualquier usuario con rol válido puede ver el
-- listado básico del equipo.
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users FOR SELECT USING (
  is_admin_or_director() OR id = auth.uid() OR get_my_role() IS NOT NULL
);
