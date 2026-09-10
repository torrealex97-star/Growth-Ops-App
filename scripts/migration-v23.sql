-- ============================================================
-- v23 — Correo personal del colaborador (separado del de empresa)
--   · users.personal_email: correo PERSONAL, se usa SOLO para el contrato
--     (firma + copia). El correo de empresa (users.email) sigue siendo el de
--     login, conexión de calendarios (Calendly/GHL) y todo lo demás.
--   Se puede "marcar" antes de enviar el contrato (al invitar o manual) y se
--   persiste aquí para reutilizarlo en futuros contratos.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS personal_email TEXT;

-- ============================================================
-- FIN v23
-- ============================================================
