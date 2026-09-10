-- ============================================================
-- v57 — Tipo y número de documento del alumno (sin foto)
--   Sustituye el flujo de "excepción con motivo" por un registro directo:
--   el closer elige tipo de documento (DNI/Pasaporte/NIE/Otro) y escribe
--   el número. DNI/NIE se validan por checksum; Pasaporte y Otro pasan
--   sin validación de formato (Otro es el cortafuegos: siempre pasa).
-- ============================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS student_document_type TEXT
  CHECK (student_document_type IN ('dni', 'pasaporte', 'nie', 'otro'));
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS student_document_number TEXT;

-- ============================================================
-- FIN v57
-- ============================================================
