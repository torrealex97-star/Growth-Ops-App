-- Fusión de contactos duplicados (Configuración → Data Health → "Fusionar duplicados"): repunta
-- dinámicamente CUALQUIER fila que referencie al contacto duplicado (appointments, sales,
-- contact_attributions, contracts, stripe_customers, etc. — cualquier FK actual o futura hacia
-- contacts(id)) hacia el contacto primario, y marca el duplicado como fusionado en vez de
-- borrarlo (conserva histórico/auditoría). No usamos una lista de tablas a mano: con más de 10
-- tablas referenciando contacts.id y creciendo, una lista fija se queda desactualizada y deja
-- huérfanos silenciosos — se recorre el catálogo de FKs reales en el momento de fusionar.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES public.contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS contacts_merged_into_idx ON public.contacts(merged_into) WHERE merged_into IS NOT NULL;

CREATE OR REPLACE FUNCTION public.merge_contacts(p_tenant_id UUID, p_primary_id UUID, p_duplicate_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  IF p_primary_id = p_duplicate_id THEN
    RAISE EXCEPTION 'El contacto primario y el duplicado no pueden ser el mismo';
  END IF;

  PERFORM 1 FROM public.contacts WHERE id = p_primary_id AND tenant_id = p_tenant_id AND merged_into IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contacto primario no encontrado (o ya fusionado) en este tenant';
  END IF;
  PERFORM 1 FROM public.contacts WHERE id = p_duplicate_id AND tenant_id = p_tenant_id AND merged_into IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contacto duplicado no encontrado (o ya fusionado) en este tenant';
  END IF;

  -- referred_by describe una relación entre dos personas distintas (quién refirió a quién), no
  -- un duplicado a fusionar — se excluye explícitamente para no reescribir esa relación.
  FOR r IN
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'contacts'
      AND ccu.column_name = 'id'
      AND NOT (tc.table_name = 'contacts' AND kcu.column_name = 'referred_by')
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', r.table_name, r.column_name, r.column_name)
        USING p_primary_id, p_duplicate_id;
    EXCEPTION WHEN unique_violation THEN
      -- Repuntar crearía un duplicado bajo una restricción UNIQUE (p.ej. ya existe esa fila para
      -- el contacto primario): se descarta la fila del contacto duplicado en vez de abortar toda
      -- la fusión por un registro secundario.
      EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.table_name, r.column_name) USING p_duplicate_id;
    END;
  END LOOP;

  UPDATE public.contacts SET merged_into = p_primary_id, updated_at = NOW() WHERE id = p_duplicate_id;
END;
$$;
