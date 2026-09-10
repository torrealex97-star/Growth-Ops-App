-- Migración v37: cualificación (respuestas del formulario) a nivel de contacto.
--
-- Hasta ahora las respuestas del formulario de Calendly vivían solo en
-- appointments.qualification (JSONB), por lo que:
--   - Al reprogramar (fila de cita nueva) se podían perder.
--   - No se podían consultar/agregar por contacto en Atribución ni en el Dashboard.
--
-- Guardamos un snapshot de la última cualificación conocida en el contacto para
-- poder revisar la CALIDAD del lead sin depender de la cita concreta.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS qualification JSONB,
  ADD COLUMN IF NOT EXISTS qualification_updated_at TIMESTAMPTZ;

-- Índice GIN para poder filtrar/consultar por respuestas (p. ej. ingresos, situación).
CREATE INDEX IF NOT EXISTS idx_contacts_qualification ON contacts USING gin (qualification);

-- Backfill: copiamos la cualificación de la cita más reciente (con datos) a cada contacto.
UPDATE contacts c
SET qualification = a.qualification,
    qualification_updated_at = COALESCE(a.appointment_datetime, a.created_at)
FROM (
  SELECT DISTINCT ON (contact_id)
         contact_id, qualification, appointment_datetime, created_at
  FROM appointments
  WHERE qualification IS NOT NULL
    AND qualification <> '{}'::jsonb
    AND (qualification ? 'respuestas')
    AND jsonb_array_length(COALESCE(qualification->'respuestas', '[]'::jsonb)) > 0
  ORDER BY contact_id, COALESCE(appointment_datetime, created_at) DESC
) a
WHERE c.id = a.contact_id
  AND c.qualification IS NULL;
