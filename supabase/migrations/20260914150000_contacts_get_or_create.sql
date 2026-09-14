-- Resolver-o-crear contacto de forma ATÓMICA.
--
-- Problema real: los webhooks de Calendly y GHL hacían check-then-insert (SELECT por
-- ghl_contact_id/email/teléfono y, si no hay nada, INSERT) en dos viajes distintos a la base de
-- datos. Dos entregas concurrentes del mismo lead —Calendly reintentando, o Calendly y GHL
-- notificando el mismo optin a la vez— pasan las dos por el SELECT en vacío y crean DOS contactos.
-- A partir de ahí el lead queda partido: citas en un contacto, venta en el otro, y los embudos
-- cuentan dos personas donde hay una.
--
-- No se resuelve con un UNIQUE sobre (tenant_id, email): ya hay duplicados históricos (existe la
-- pantalla Configuración → Data Health → "Fusionar duplicados" precisamente por eso), así que la
-- constraint fallaría al crearse, y aunque se creara rechazaría escrituras legítimas en vez de
-- unificarlas. Lo que hace falta es serializar la ventana entre el SELECT y el INSERT: un advisory
-- lock por clave de identidad (subcuenta + email / teléfono / id de GHL) que se libera al terminar
-- la transacción. Dos entregas simultáneas del mismo lead se ponen en fila; la segunda encuentra el
-- contacto que creó la primera y lo devuelve en vez de duplicarlo. Leads distintos no se estorban
-- porque el lock va por clave, no por tabla.
--
-- Dos correcciones que salen del mismo sitio, por ser este el único punto de resolución:
--  - El encaje va por las columnas normalizadas (email_normalized / phone_normalized, ver
--    20260914130000_contacts_identity_uniques.sql). Antes se comparaba el valor crudo, así que
--    "Ana@x.com" y "ana@x.com" —o "+34 612 345 678" y "34612345678"— eran contactos distintos.
--  - Si la coincidencia es un contacto ya fusionado (merged_into), se sigue el puntero hasta el
--    primario. Antes, una cita nueva de un lead fusionado aterrizaba en el duplicado muerto y
--    volvía a partir el historial justo después de haberlo unificado.
--
-- Devuelve `created` para que quien llama sepa si tiene que rellenar el contacto existente
-- (last_seen_at, teléfono, backfill del id de GHL…) o si ya se insertó completo.

CREATE OR REPLACE FUNCTION public.contacts_get_or_create(
  p_tenant_id UUID,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_ghl_contact_id TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_instagram TEXT DEFAULT NULL,
  p_age INT DEFAULT NULL,
  p_lead_status TEXT DEFAULT NULL,
  p_seen_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (id UUID, full_name TEXT, ghl_contact_id TEXT, created BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Mismas expresiones que las columnas generadas, para que el encaje use sus índices.
  v_email TEXT := NULLIF(lower(btrim(coalesce(p_email, ''))), '');
  v_phone TEXT := NULLIF(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_ghl   TEXT := NULLIF(btrim(coalesce(p_ghl_contact_id, '')), '');
  v_id UUID;
  v_merged UUID;
  v_hops INT := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'contacts_get_or_create: falta la subcuenta (p_tenant_id)';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL AND v_ghl IS NULL THEN
    RAISE EXCEPTION 'contacts_get_or_create: sin email, teléfono ni id de GHL no se puede identificar al contacto';
  END IF;

  -- Locks en orden fijo (ghl → email → teléfono) para que dos entregas que comparten dos claves no
  -- se bloqueen mutuamente en orden inverso. Son advisory de transacción: se sueltan al commit.
  IF v_ghl IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact:' || p_tenant_id::text || ':g:' || v_ghl));
  END IF;
  IF v_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact:' || p_tenant_id::text || ':e:' || v_email));
  END IF;
  IF v_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact:' || p_tenant_id::text || ':p:' || v_phone));
  END IF;

  -- Misma prioridad de encaje que tenían los webhooks: id de GHL → email → teléfono.
  -- ORDER BY created_at: si el histórico ya tiene duplicados para esa clave, se elige siempre el
  -- mismo (el más antiguo) en vez de fallar como hacía maybeSingle().
  IF v_ghl IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.tenant_id = p_tenant_id AND c.ghl_contact_id = v_ghl
    ORDER BY c.created_at ASC LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.tenant_id = p_tenant_id AND c.email_normalized = v_email
    ORDER BY c.created_at ASC LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.tenant_id = p_tenant_id AND c.phone_normalized = v_phone
    ORDER BY c.created_at ASC LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Seguir la cadena de fusión hasta el contacto vivo. El tope de saltos evita quedarse colgado
    -- si una fusión mal hecha dejó un ciclo.
    LOOP
      SELECT c.merged_into INTO v_merged FROM public.contacts c WHERE c.id = v_id AND c.tenant_id = p_tenant_id;
      EXIT WHEN v_merged IS NULL OR v_hops >= 10;
      v_id := v_merged;
      v_hops := v_hops + 1;
    END LOOP;

    RETURN QUERY
      SELECT c.id, c.full_name, c.ghl_contact_id, FALSE
      FROM public.contacts c WHERE c.id = v_id;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO public.contacts (
      tenant_id, full_name, first_name, last_name, email, phone,
      ghl_contact_id, instagram, age, lead_status, first_seen_at, last_seen_at
    )
    VALUES (
      p_tenant_id,
      coalesce(NULLIF(btrim(coalesce(p_full_name, '')), ''), 'Sin nombre'),
      NULLIF(btrim(coalesce(p_first_name, '')), ''),
      NULLIF(btrim(coalesce(p_last_name, '')), ''),
      NULLIF(btrim(coalesce(p_email, '')), ''),
      NULLIF(btrim(coalesce(p_phone, '')), ''),
      v_ghl,
      NULLIF(btrim(coalesce(p_instagram, '')), ''),
      p_age,
      coalesce(NULLIF(btrim(coalesce(p_lead_status, '')), ''), 'registrado'),
      p_seen_at,
      p_seen_at
    )
    RETURNING contacts.id, contacts.full_name, contacts.ghl_contact_id, TRUE;
END;
$$;

-- Solo la llaman los webhooks server-side (service-role). No se concede a `authenticated`: la
-- función recibe la subcuenta como parámetro, y con SECURITY INVOKER la RLS sigue aplicando, pero
-- no hay ningún cliente de navegador que la necesite.
REVOKE ALL ON FUNCTION public.contacts_get_or_create(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contacts_get_or_create(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ
) TO service_role;
