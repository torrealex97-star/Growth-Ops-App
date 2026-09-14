-- Identidades normalizadas por subcuenta. Las columnas originales conservan el valor tal como llegó
-- (para presentación); las generadas dan una clave estable para comparar: "  Alex@Example.COM " y
-- "alex@example.com" son la misma persona, y "+34 612-345-678" y "34612345678" el mismo teléfono.
-- Antes cada webhook comparaba el valor crudo, así que la misma persona entraba dos veces por venir
-- escrita distinta.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_normalized text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_normalized text
  GENERATED ALWAYS AS (NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), '')) STORED;

-- Índices por subcuenta para el encaje de contacto de los webhooks (contacts_get_or_create).
CREATE INDEX IF NOT EXISTS contacts_tenant_email_normalized_idx
  ON public.contacts (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_tenant_phone_normalized_idx
  ON public.contacts (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- NO se pone UNIQUE sobre el teléfono normalizado, ni ahora ni después. Un teléfono compartido es
-- legítimo y frecuente (una pareja, una familia apuntando a dos niños, el fijo de una empresa con
-- dos interlocutores): un UNIQUE ahí rechazaría contactos reales. El teléfono sirve para ENCAJAR un
-- lead, no para afirmar que dos personas con el mismo número son la misma.
-- El UNIQUE sobre el email normalizado sí va, en su propia migración
-- (20260914160000_contacts_email_unique.sql), porque exige que el histórico esté limpio primero.
