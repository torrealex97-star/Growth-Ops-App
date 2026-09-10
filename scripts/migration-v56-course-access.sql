-- Control de accesos al curso desde la plataforma (los cursos viven en GHL/plataforma propia).
-- No sustituye a GHL como fuente de verdad del acceso real; registra CUÁNDO se concedió/revocó
-- desde aquí y dispara el mismo webhook saliente que ya usa el onboarding (lib/ghl.ts) para que
-- la automatización de GHL ejecute la acción real.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS course_access_granted_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS course_access_revoked_at TIMESTAMPTZ;
