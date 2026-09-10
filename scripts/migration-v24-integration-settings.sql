-- v24 — SaaS Nivel 1: configuración de integraciones editable desde la app.
-- Almacena tokens/keys/cuentas por instalación. Los valores marcados is_secret
-- van CIFRADOS (AES-256-GCM, prefijo enc:v1:) con CONFIG_ENC_KEY; el resto en claro.
-- Se leen SOLO en servidor con service-role (RLS deniega a anon/authenticated).
-- Requiere helper existente: handle_updated_at().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.integration_settings (
  key         TEXT PRIMARY KEY,           -- p.ej. META_ACCESS_TOKEN, IG_USER_ID, RESEND_FROM…
  value       TEXT,                       -- cifrado (enc:v1:…) si is_secret; texto plano si no
  is_secret   BOOLEAN NOT NULL DEFAULT true,
  label       TEXT,                       -- descripción humana (opcional)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID
);

-- Trigger updated_at (si el helper existe en el esquema base)
DROP TRIGGER IF EXISTS integration_settings_updated_at ON public.integration_settings;
CREATE TRIGGER integration_settings_updated_at
  BEFORE UPDATE ON public.integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: nadie (anon/authenticated) accede directo; solo service-role (que salta RLS).
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
-- Sin políticas => acceso denegado por defecto salvo service-role. Los tokens nunca
-- llegan al cliente: la UI lee/escribe a través de endpoints con service-role.
