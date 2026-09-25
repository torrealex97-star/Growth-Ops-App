-- Canal de origen en el ÚNICO punto de creación de contactos vía webhooks.
--
-- Problema (auditoría de los 375 contactos borrados, 2026-09-23): los 281 sin canal llegaron por
-- GHL sin `source`, y `contacts_get_or_create` — por donde entra TODO contacto de GHL y Calendly —
-- no aceptaba canal. El dato llegaba a la app (el webhook lo tiene) y se perdía en la frontera.
-- A partir de aquí, el canal de origen se estampa en la creación, normalizado; si el webhook no lo
-- trae, queda NULL: un hueco es un hueco y Data Health lo cuenta (nunca se rellena con un valor
-- inventado). La normalización la define `contacts_normalize_lead_channel` (20260923100000) y el
-- trigger + CHECK de esa misma migración son la red final incluso para escrituras fuera de la app.
--
-- El canal SOLO se estampa al CREAR: si el contacto ya existía, no se toca (la creación es
-- first-touch; sobreescribir con la entrega de hoy destruiría la atribución original).
--
-- La firma cambia (se añade el último parámetro): se elimina la firma antigua para no dejar una
-- sobrecarga muerta y se rehacen los grants. El hardening (20260917100000) concedió EXECUTE a
-- `authenticated` también; aquí se vuelve al reparto de la migración original — solo service_role —
-- porque ningún cliente de navegador la llama (verificado: los únicos invocantes son los dos
-- webhooks server-side).

DROP FUNCTION IF EXISTS public.contacts_get_or_create(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ
);

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
  p_seen_at TIMESTAMPTZ DEFAULT NOW(),
  p_lead_channel TEXT DEFAULT NULL
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
  -- Canal en su forma canónica (trim + espacios colapsados + minúsculas; vacío → NULL).
  v_canal TEXT := public.contacts_normalize_lead_channel(p_lead_channel);
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

    -- Contacto existente: se devuelve tal cual. El canal recibido se descarta — first-touch.
    RETURN QUERY
      SELECT c.id, c.full_name, c.ghl_contact_id, FALSE
      FROM public.contacts c WHERE c.id = v_id;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO public.contacts (
      tenant_id, full_name, first_name, last_name, email, phone,
      ghl_contact_id, instagram, age, lead_status, lead_channel, first_seen_at, last_seen_at
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
      v_canal,
      p_seen_at,
      p_seen_at
    )
    RETURNING contacts.id, contacts.full_name, contacts.ghl_contact_id, TRUE;
END;
$$;

-- Solo la llaman los webhooks server-side (service-role). Sin cliente de navegador: la función
-- recibe la subcuenta como parámetro y con SECURITY INVOKER la RLS sigue aplicando.
REVOKE ALL ON FUNCTION public.contacts_get_or_create(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_get_or_create(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;
