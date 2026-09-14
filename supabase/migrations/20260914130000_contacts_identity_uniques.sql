-- Identidades normalizadas por subcuenta. Las columnas generadas conservan el valor original para
-- presentación, pero ofrecen una clave estable para webhooks concurrentes y formatos equivalentes.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_normalized text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_normalized text
  GENERATED ALWAYS AS (NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), '')) STORED;

DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(format('%s/%s (%s)', tenant_id, email_normalized, n), ', ')
    INTO duplicates
    FROM (
      SELECT tenant_id, email_normalized, count(*) AS n
      FROM public.contacts
      WHERE email_normalized IS NOT NULL
      GROUP BY tenant_id, email_normalized
      HAVING count(*) > 1
    ) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Contactos duplicados por email normalizado: %', duplicates;
  END IF;

  SELECT string_agg(format('%s/%s (%s)', tenant_id, phone_normalized, n), ', ')
    INTO duplicates
    FROM (
      SELECT tenant_id, phone_normalized, count(*) AS n
      FROM public.contacts
      WHERE phone_normalized IS NOT NULL
      GROUP BY tenant_id, phone_normalized
      HAVING count(*) > 1
    ) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Contactos duplicados por teléfono normalizado: %', duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_email_normalized_key
  ON public.contacts (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_normalized_key
  ON public.contacts (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;
