-- ATRIBUCIÓN AUTOMÁTICA DE CONTACTOS GHL AL NACER/ACTIVAR UN COLABORADOR
-- (continúa el invariant de 20260921190000: nada del sistema de Colaboradores
--  puede seguir dependiendo de un backfill SQL manual).
--
-- HUECO REAL detectado en producción (21-sep): el webhook GHL escribe
-- utm_content = código del ?ref= SIEMPRE, pero collaborator_id solo rellena si
-- resolverColaboradorPorCodigo() encuentra el perfil ACTIVO en ese instante.
-- Si los contactos llegan ANTES del alta del colaborador (campaña enviada a su
-- lista, ficha creada después) o mientras estaba 'invited', quedan con
-- utm_content=código y collaborator_id=NULL → sin comisiones hasta que un
-- admin hace backfill a mano (como pasó con Noelia: 50 contactos por SQL).
--
-- REGLA FINANCIERA que esto respeta (no la cambia): FIRST VALID COLLABORATOR
-- WINS. El código identificador del enlace de referencia ES el primer toque
-- válido — llegó en el contacto original de GHL. Este trigger rellena
-- collaborator_id solo cuando sigue NULL. Si el contacto ya trae otro
-- colaborador (o un override admin con motivo), no pisa NADA. Es el mismo
-- criterio que registrarToque aplica en caliente para el fill condicional.
--
-- Se dispara en tres caminos (los mismos del invariant de perfiles):
--   · INSERT/UPDATE en users con rol affiliate (invite o edición de rol),
--   · INSERT en tenant_members (pertenencia posterior al rol),
--   · UPDATE en collaborator_profiles cuando pasa a 'active' (el webhook de
--     GHL solo resuelve perfiles activos: activarse destraba los contactos
--     que llegaron mientras la ficha estaba invited).
-- Y un backfill único que repara el histórico existente.

-- 1) Núcleo: para cada fila de atribución de esta subcuenta cuyo utm_content
--    coincida con el código del colaborador y NO tenga aún colaborador, lo
--    llena (fill condicional) y deja rastro en audit_logs. Idempotente.
CREATE OR REPLACE FUNCTION public.attribute_ghl_contacts_for_collaborator(
  p_tenant_id uuid,
  p_profile_id uuid,
  p_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_updated integer := 0;
  fila record;
BEGIN
  IF v_code = '' OR p_profile_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR fila IN
    SELECT ca.id, ca.contact_id
    FROM public.contact_attributions ca
    WHERE ca.tenant_id = p_tenant_id
      AND ca.collaborator_id IS NULL
      AND upper(btrim(coalesce(ca.utm_content, ''))) = v_code
    FOR UPDATE
  LOOP
    UPDATE public.contact_attributions
    SET collaborator_id = p_profile_id,
        updated_at = now()
    WHERE id = fila.id
      AND collaborator_id IS NULL;  -- guard: primera atribución válida gana

    v_updated := v_updated + 1;
    INSERT INTO public.audit_logs (tenant_id, entity_type, entity_id, action, old_values, new_values)
    VALUES (
      p_tenant_id,
      'contact_attribution',
      fila.contact_id,
      'collaborator_attribution',
      jsonb_build_object('collaborator_id', NULL),
      jsonb_build_object(
        'collaborator_id', p_profile_id,
        'via', 'ghl_backfill_trigger',
        'code', v_code
      )
    );
  END LOOP;

  RETURN v_updated;
END;
$fn$;

-- 2) Trigger sobre collaborator_profiles: al ACTIVARSE una ficha (o cambiar el
--    código), atribuye los contactos GHL pendientes de su código.
CREATE OR REPLACE FUNCTION public.ghl_backfill_on_profile_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_old_status text;
  v_new_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_status := OLD.status;
    v_new_status := NEW.status;
    -- Nada que hacer si ni el estado (a active) ni el código cambiaron.
    IF upper(btrim(coalesce(NEW.code, ''))) = upper(btrim(coalesce(OLD.code, '')))
       AND v_new_status = v_old_status THEN
      RETURN NEW;
    END IF;
  ELSE
    v_new_status := NEW.status;
  END IF;

  PERFORM public.attribute_ghl_contacts_for_collaborator(
    NEW.tenant_id, NEW.id, NEW.code
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ghl_backfill_profile ON public.collaborator_profiles;
CREATE TRIGGER trg_ghl_backfill_profile
  AFTER INSERT OR UPDATE OF code, status ON public.collaborator_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ghl_backfill_on_profile_change();

-- 3) Triggers de users y tenant_members: mismo patrón del invariant de perfiles
--    (20260921190000). Sin lógica condicional en el nombre del trigger: la
--    función decide (barato: sale enseguida si no es affiliate).
CREATE OR REPLACE FUNCTION public.ghl_backfill_on_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role text;
  m record;
BEGIN
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = NEW.role_id;
  IF v_role IS NULL OR v_role <> 'affiliate' THEN
    RETURN NEW;
  END IF;

  FOR m IN SELECT tenant_id FROM public.tenant_members WHERE user_id = NEW.id
  LOOP
    PERFORM public.attribute_ghl_contacts_for_collaborator(
      m.tenant_id,
      (SELECT cp.id FROM public.collaborator_profiles cp
        WHERE cp.tenant_id = m.tenant_id AND cp.user_id = NEW.id
        LIMIT 1),
      NEW.tracking_code
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ghl_backfill_user ON public.users;
CREATE TRIGGER trg_ghl_backfill_user
  AFTER INSERT OR UPDATE OF role_id, tracking_code ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ghl_backfill_on_user_role();

CREATE OR REPLACE FUNCTION public.ghl_backfill_on_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.users%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = NEW.user_id;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = u.role_id;
  IF v_role IS NULL OR v_role <> 'affiliate' THEN
    RETURN NEW;
  END IF;

  PERFORM public.attribute_ghl_contacts_for_collaborator(
    NEW.tenant_id,
    (SELECT cp.id FROM public.collaborator_profiles cp
      WHERE cp.tenant_id = NEW.tenant_id AND cp.user_id = NEW.user_id
      LIMIT 1),
    u.tracking_code
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ghl_backfill_membership ON public.tenant_members;
CREATE TRIGGER trg_ghl_backfill_membership
  AFTER INSERT ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.ghl_backfill_on_membership();

-- 4) Backfill único del histórico (idempotente): los casos como el de Liset.
--    El bucle del trigger no corre en el UPDATE directo de abajo, así que lo
--    replico fila a fila con el mismo criterio first-valid-wins:
--    para cada perfil, rellena SOLO las filas sin colaborador de su código.
DO $backfill$
DECLARE
  p record;
  v_code text;
BEGIN
  FOR p IN
    SELECT cp.tenant_id, cp.id, cp.code
    FROM public.collaborator_profiles cp
  LOOP
    v_code := upper(btrim(coalesce(p.code, '')));
    CONTINUE WHEN v_code = '';
    UPDATE public.contact_attributions ca
    SET collaborator_id = p.id,
        updated_at = now()
    WHERE ca.tenant_id = p.tenant_id
      AND ca.collaborator_id IS NULL
      AND upper(btrim(coalesce(ca.utm_content, ''))) = v_code;
  END LOOP;
END;
$backfill$;

-- Auditoría del backfill histórico (el trigger ya audita en vivo, aquí en lote).
INSERT INTO public.audit_logs (tenant_id, entity_type, entity_id, action, old_values, new_values)
SELECT ca.tenant_id, 'contact_attribution', ca.contact_id, 'collaborator_attribution',
       jsonb_build_object('collaborator_id', NULL),
       jsonb_build_object('collaborator_id', ca.collaborator_id, 'via', 'ghl_backfill_migration')
FROM public.contact_attributions ca
JOIN public.collaborator_profiles cp ON cp.id = ca.collaborator_id
WHERE ca.updated_at >= now() - interval '1 minute'
  AND ca.utm_content IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.entity_type = 'contact_attribution'
      AND al.entity_id = ca.contact_id::text
      AND al.action = 'collaborator_attribution'
      AND al.new_values->>'via' = 'ghl_backfill_migration'
  );
