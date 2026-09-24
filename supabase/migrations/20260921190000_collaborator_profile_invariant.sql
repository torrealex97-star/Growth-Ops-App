-- RED DE SEGURIDAD DEL ALTA DE COLABORADORES (auditoría 21-sep, post-PR #142).
--
-- Problema: la creación del perfil de colaborador dependía de CADA camino de
-- código (invite, edición de rol, POST /colaboradores, registro público). El
-- camino de edición de rol en la UI y cualquier vía futura (imports, SQL
-- manual, un endpoint nuevo) podían dejar un usuario con rol affiliate SIN
-- perfil → invisible en el listado de Colaboradores y sin atribución posible.
--
-- Solución: INVARIANTE EN LA BD. Un trigger tras INSERT/UPDATE de users garantiza
-- que todo usuario con rol 'affiliate' tiene su ficha en collaborator_profiles
-- por cada subcuenta de la que es miembro (tenant_members), con:
--   · code = tracking_code del usuario (los enlaces ?ref= existentes valen);
--   · idempotencia total (ON CONFLICT DO NOTHING: no pisa % ni estado gestionados);
--   · status 'invited' (el contrato/activación sigue siendo proceso del admin).
--
-- Reversible y seguro: no toca filas existentes, solo completa las que faltan.

-- 1) Función del invariant.
CREATE OR REPLACE FUNCTION public.ensure_collaborator_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  affected record;
BEGIN
  -- Solo interesa el colectivo colaborador; otros roles no generan ficha.
  IF NEW.role_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id = NEW.role_id AND r.key = 'affiliate'
  ) THEN
    RETURN NEW;
  END IF;

  -- Un perfil por cada subcuenta de la que el usuario sea miembro. Si aún no
  -- es miembro de ninguna, el trigger de tenant_members de abajo lo cubrirá.
  FOR affected IN
    SELECT m.tenant_id
    FROM public.tenant_members m
    WHERE m.user_id = NEW.id
  LOOP
    INSERT INTO public.collaborator_profiles (tenant_id, user_id, code, name, status, default_commission_percent)
    VALUES (
      affected.tenant_id,
      NEW.id,
      UPPER(COALESCE(NEW.tracking_code, 'SIN-' || substr(NEW.id::text, 1, 8))),
      COALESCE(NEW.full_name, NEW.email),
      'invited',
      NEW.default_affiliate_commission_percent
    )
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ensure_collaborator_profile ON public.users;
CREATE TRIGGER trg_ensure_collaborator_profile
  AFTER INSERT OR UPDATE OF role_id, tracking_code, full_name ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_collaborator_profile();

-- 2) El mismo invariant cuando la pertenencia a la subcuenta llega DESPUÉS del
--    rol (orden invite: primero users, luego tenant_members en el mismo flujo).
CREATE OR REPLACE FUNCTION public.ensure_collaborator_profile_on_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = NEW.user_id;
  IF u.id IS NULL OR u.role_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id = u.role_id AND r.key = 'affiliate'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.collaborator_profiles (tenant_id, user_id, code, name, status, default_commission_percent)
  VALUES (
    NEW.tenant_id,
    NEW.user_id,
    UPPER(COALESCE(u.tracking_code, 'SIN-' || substr(NEW.user_id::text, 1, 8))),
    COALESCE(u.full_name, u.email),
    'invited',
    u.default_affiliate_commission_percent
  )
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ensure_collaborator_profile_membership ON public.tenant_members;
CREATE TRIGGER trg_ensure_collaborator_profile_membership
  AFTER INSERT ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_collaborator_profile_on_membership();

-- 3) Backfill único: completa perfiles de affiliates existentes que carezcan de
--    ellos (idempotente; hoy tras reparar a Liset debe insertar 0 filas).
INSERT INTO public.collaborator_profiles (tenant_id, user_id, code, name, status, default_commission_percent)
SELECT m.tenant_id,
       u.id,
       UPPER(COALESCE(u.tracking_code, 'SIN-' || substr(u.id::text, 1, 8))),
       COALESCE(u.full_name, u.email),
       'invited',
       u.default_affiliate_commission_percent
FROM public.tenant_members m
JOIN public.users u ON u.id = m.user_id
JOIN public.roles r ON r.id = u.role_id
WHERE r.key = 'affiliate'
ON CONFLICT (tenant_id, user_id) DO NOTHING;
