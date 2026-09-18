-- FIX DE RECURSIÓN RLS (detectado en verificación visual 2026-09-18).
--
-- La migración 20260918150000 añadió a `appointments_select_scope` la rama:
--
--   OR EXISTS (SELECT 1 FROM contact_attributions ca
--              WHERE ca.contact_id = appointments.contact_id
--                AND is_my_collaborator_row(ca.contact_id))
--
-- El EXISTS lee contact_attributions BAJO RLS, y la policy SELECT de esa tabla
-- contiene a su vez un EXISTS sobre appointments (diseño preexistente del scope
-- de setter/closer). Postgres detecta el ciclo appointments →
-- contact_attributions → appointments y rechaza TODA consulta a cualquiera de
-- las dos tablas —también para admins— con "infinite recursion detected in
-- policy for relation appointments".
--
-- La rama era además redundante: is_my_collaborator_row() es SECURITY DEFINER
-- (no re-entra en RLS) y ya comprueba exactamente eso: que exista una
-- atribución de un perfil ACTIVO mío para el contacto dado. Basta con llamarla
-- directamente sobre appointments.contact_id, igual que ya hacen las policies
-- de sales (is_my_collaborator_sale(id)) y contact_attributions
-- (is_my_collaborator_row(contact_id)) de la misma migración 150000.

DROP POLICY IF EXISTS appointments_select_scope ON public.appointments;
CREATE POLICY appointments_select_scope ON public.appointments FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
  OR public.is_my_collaborator_row(appointments.contact_id)
);

-- ----------------------------------------------------------------------------
-- NOTAS DE APLICACIÓN (misma vía que 20260918150000: pooler transaccional).
-- Verificación post-aplicación: la policy debe quedar con la llamada directa a
-- is_my_collaborator_row(appointments.contact_id) y las consultas de
-- appointments/contact_attributions de un usuario autenticado no-admin no
-- deben devolver "infinite recursion detected in policy".
-- ----------------------------------------------------------------------------
