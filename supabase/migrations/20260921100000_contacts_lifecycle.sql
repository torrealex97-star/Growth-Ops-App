-- F6 (privacidad): marcador de ciclo de vida del contacto tras un borrado de persona.
-- El ejecutor de `erase_person` (lib/privacidad/erase-person.ts) conserva la fila sin PII y la
-- marca con lifecycle='erased' para no romper hechos con obligación legal — pero la columna no
-- existía: el update fantasma habría devuelto 400 y el borrado habría fallado en su primer uso.
-- Aditiva y reversible: NULL = contacto vivo; 'erased' = anonimizado por erase_person.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lifecycle TEXT;

CREATE INDEX IF NOT EXISTS contacts_lifecycle_erased_idx
  ON public.contacts (tenant_id)
  WHERE lifecycle = 'erased';
