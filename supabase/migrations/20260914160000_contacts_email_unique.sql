-- UNIQUE sobre (tenant_id, email_normalized): la garantía dura de que un email no puede pertenecer a
-- dos contactos de la misma subcuenta.
--
-- VA EN SU PROPIA MIGRACIÓN, Y LA ÚLTIMA, A PROPÓSITO. La app arrastra duplicados históricos —de ahí
-- que exista Configuración → Data Health → "Fusionar duplicados"—, así que este índice puede no
-- poder crearse todavía. Si falla, el error lista exactamente qué emails hay que fusionar: se
-- resuelven en esa pantalla y se vuelve a aplicar. Mientras tanto la carrera que originó todo esto YA
-- está cerrada por `contacts_get_or_create` (advisory lock por clave de identidad), que no necesita
-- datos limpios; este índice es el cinturón, no el freno.
--
-- No se fusiona nada automáticamente aquí: decidir qué contacto es el primario y qué historial se
-- arrastra es una decisión sobre datos del usuario, no algo que deba resolver una migración.
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(format('%s/%s (%s contactos)', tenant_id, email_normalized, n), ', ')
    INTO duplicados
    FROM (
      SELECT tenant_id, email_normalized, count(*) AS n
      FROM public.contacts
      WHERE email_normalized IS NOT NULL AND merged_into IS NULL
      GROUP BY tenant_id, email_normalized
      HAVING count(*) > 1
    ) d;
  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'Hay contactos que comparten email en la misma subcuenta. Fusiónalos en Configuración → Data Health → "Fusionar duplicados" y vuelve a aplicar esta migración. Duplicados: %', duplicados;
  END IF;
END $$;

-- Parcial: los contactos sin email no compiten entre sí, y los ya fusionados conservan su email
-- como histórico sin bloquear al primario.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_email_normalized_key
  ON public.contacts (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL AND merged_into IS NULL;
