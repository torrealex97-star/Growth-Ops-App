-- REGLA "SOLO AGENDARON" EN LA ATRIBUCIÓN DEL COLABORADOR (pide el propietario
-- 21-sep tras ver el alcance de Noelia): no todo contacto GHL con el código es
-- suyo — SOLO los que AGENDARON. Un lead que llegó y no pidió cita (o cuya única
-- cita está cancelada) no genera comisiones ni trabajo de seguimiento al
-- colaborador: no se le atribuye.
--
-- Se aplica a la función de atribución (misma firma y sus tres triggers de
-- 20260921194500 intactos) para que la regla valga para:
--   · el backfill de cualquier perfil nuevo o activado,
--   · cualquier re-entrega que rellene pendientes vía trigger.
-- El corte temporal de agosto 2026 (migración 20260921230000) sigue vigente.
-- En caliente, el webhook GHL aplica el mismo gate: solo atribuye el código en
-- entregas de cita viva (ver lib/collaborators/ref-signal.ts y el webhook).
-- La cancelación posterior NO revoca automáticamente una atribución ya hecha
-- (el histórico de dinero no cambia solo): eso sigue siendo decisión de admin.
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
  v_cutoff timestamptz := TIMESTAMPTZ '2026-08-01 00:00:00+00';
  v_updated integer := 0;
  fila record;
BEGIN
  IF v_code = '' OR p_profile_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR fila IN
    SELECT ca.id, ca.contact_id
    FROM public.contact_attributions ca
    JOIN public.contacts c ON c.id = ca.contact_id
    WHERE ca.tenant_id = p_tenant_id
      AND ca.collaborator_id IS NULL
      AND upper(btrim(coalesce(ca.utm_content, ''))) = v_code
      AND coalesce(c.first_seen_at, c.created_at) >= v_cutoff
      -- SOLO AGENDARON: con al menos una cita viva (no cancelada). El lead que
      -- solo llegó y no pidió cita no es del colaborador.
      AND EXISTS (
        SELECT 1
        FROM public.appointments ap
        WHERE ap.contact_id = ca.contact_id
          AND ap.tenant_id = ca.tenant_id
          AND ap.status <> 'cancelled'
      )
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
        'code', v_code,
        'regla', 'solo_agendaron'
      )
    );
  END LOOP;

  RETURN v_updated;
END;
$fn$;
