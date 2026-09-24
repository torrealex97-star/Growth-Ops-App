-- REGLA DE ATRIBUCIÓN GHL DEL COLABORADOR: CUTOFF AGOSTO 2026 + CAMPO PERSONALIZADO
-- (pide el propietario 21-sep, tras ver el listado con contactos de abril/julio).
--
-- 1) CUTOFF TEMPORAL Y DURADERO: un contacto cuya fecha real (first_seen_at de
--    GHL, o created_at) es ANTERIOR al 2026-08-01 NO puede atribuirse a
--    colaboradores. Ni ahora ni en el futuro: la función de atribución lo
--    filtra, así que ningún trigger, backfill o re-entrega vuelve a pintar
--    contactos de antes de agosto. La misma constante vive en
--    lib/collaborators/ref-signal.ts (corte en caliente y en datos).
-- 2) SEÑAL POR CAMPO PERSONALIZADO: además del utm_content del ?ref=, el
--    código puede llegar en cualquier campo personalizado de GHL cuyo nombre
--    pinte a referido (ref, referral, colaborador, codigo, affiliate,
--    tracking). Lo normaliza y extrae lib/collaborators/ref-signal.ts, que
--    devuelve el código al webhook para que lo escriba en utm_content cuando
--    el toque no trae uno — así el matching estructurado (utm_content =
--    código) lo recoge igual que al ?ref=, sin duplicar la regla en BD.
-- 3) CORRECCIÓN DE DATOS: se retira el colaborador de las atribuciones
--    anteriores al cutoff (2 filas reales: abril y julio de Noelia) con
--    auditoría. La relación y su dinero quedan a partir de agosto.

-- 1) FUNCIÓN DE ATRIBUCIÓN con cutoff y matching ampliado (reemplaza la de
--    20260921194500, misma firma para no romper a sus tres triggers).
--    La señal por CAMPO PERSONALIZADO la escribe la app en utm_content en
--    caliente (lib/collaborators/ref-signal.ts devuelve el código normalizado
--    y el webhook lo rellena si el toque no trae uno); aquí el matching
--    estructurado (utm_content = código) la recoge igual que al ?ref=.
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

-- 2) CORRECCIÓN DE DATOS: contactos ANTERIORES al cutoff pierden al
--    colaborador (con auditoría). Idempotente.
UPDATE public.contact_attributions ca
SET collaborator_id = NULL,
    updated_at = now()
FROM public.contacts c
WHERE c.id = ca.contact_id
  AND ca.collaborator_id IS NOT NULL
  AND coalesce(c.first_seen_at, c.created_at) < TIMESTAMPTZ '2026-08-01 00:00:00+00';

INSERT INTO public.audit_logs (tenant_id, entity_type, entity_id, action, old_values, new_values)
SELECT ca.tenant_id, 'contact_attribution', ca.contact_id, 'collaborator_attribution',
       jsonb_build_object('collaborator_id', al.old),
       jsonb_build_object('collaborator_id', NULL, 'via', 'cutoff_pre_agosto', 'cutoff', '2026-08-01')
FROM public.contact_attributions ca
JOIN public.contacts c ON c.id = ca.contact_id
JOIN LATERAL (
  SELECT old_values->>'collaborator_id' AS old
  FROM public.audit_logs a2
  WHERE a2.entity_type = 'contact_attribution'
    AND a2.entity_id = ca.contact_id::text
    AND a2.action = 'collaborator_attribution'
  ORDER BY a2.created_at DESC
  LIMIT 1
) al ON al.old IS NOT NULL
WHERE c.id = ca.contact_id
  AND ca.collaborator_id IS NULL
  AND coalesce(c.first_seen_at, c.created_at) < TIMESTAMPTZ '2026-08-01 00:00:00+00'
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs a3
    WHERE a3.entity_type = 'contact_attribution'
      AND a3.entity_id = ca.contact_id::text
      AND a3.action = 'collaborator_attribution'
      AND a3.new_values->>'via' = 'cutoff_pre_agosto'
  );

-- 3) Backfill con la regla nueva: rellena pendientes cuyo código esté en
--    utm_content (o en un campo personalizado ya merged) respetando el cutoff.
DO $backfill$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT cp.tenant_id, cp.id, cp.code
    FROM public.collaborator_profiles cp
  LOOP
    PERFORM public.attribute_ghl_contacts_for_collaborator(p.tenant_id, p.id, p.code);
  END LOOP;
END;
$backfill$;

-- Auditoría del backfill de la regla nueva (el trigger ya audita en vivo).
INSERT INTO public.audit_logs (tenant_id, entity_type, entity_id, action, old_values, new_values)
SELECT ca.tenant_id, 'contact_attribution', ca.contact_id, 'collaborator_attribution',
       jsonb_build_object('collaborator_id', NULL),
       jsonb_build_object('collaborator_id', ca.collaborator_id, 'via', 'ghl_backfill_migration')
FROM public.contact_attributions ca
WHERE ca.updated_at >= now() - interval '1 minute'
  AND ca.utm_content IS NOT NULL
  AND ca.collaborator_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.entity_type = 'contact_attribution'
      AND al.entity_id = ca.contact_id::text
      AND al.action = 'collaborator_attribution'
      AND al.new_values->>'via' = 'ghl_backfill_migration'
  );
