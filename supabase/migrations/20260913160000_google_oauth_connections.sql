-- Conexiones OAuth con Google, una por subcuenta y proveedor (GA4 y Gmail comparten el mismo
-- proyecto de Google Cloud pero son conexiones independientes: se pueden conceder por separado).
--
-- Decisiones:
--
-- * El refresh token va CIFRADO con el mismo mecanismo que el resto de secretos de la app
--   (lib/config.encryptSecret, AES-256-GCM con CONFIG_ENC_KEY). Nunca en claro: es una credencial de
--   larga duración que da acceso de lectura a la analítica y al correo del cliente.
-- * El access token NO se guarda. Caduca en una hora y se pide de nuevo con el refresh token cuando
--   hace falta; guardarlo solo añadiría otra copia de una credencial a proteger sin ganar nada.
-- * `scopes` se guarda tal y como los concedió Google, no los que pedimos. El usuario puede
--   desmarcar permisos en la pantalla de consentimiento, y hay que saber qué se concedió de verdad
--   antes de llamar a una API que va a fallar.
-- * `last_error` y `last_sync_at` para que la pantalla pueda decir "conectada pero fallando desde
--   el martes" en vez de un verde que no significa nada.

CREATE TABLE public.google_oauth_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id),
  provider       TEXT NOT NULL CHECK (provider IN ('ga4', 'gmail')),
  -- Cuenta de Google que concedió el permiso, para que se vea de quién es la conexión.
  google_email   TEXT,
  refresh_token  TEXT NOT NULL,
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  -- GA4: id de la propiedad seleccionada. Gmail: no aplica.
  ga4_property_id TEXT,
  status         TEXT NOT NULL DEFAULT 'conectada'
                   CHECK (status IN ('conectada', 'revocada', 'error')),
  last_sync_at   TIMESTAMPTZ,
  last_error     TEXT,
  connected_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola conexión por subcuenta y proveedor: reconectar SUSTITUYE, no acumula tokens huérfanos.
-- Por subcuenta, obviamente: la misma cuenta de Google puede servir a varias subcuentas.
CREATE UNIQUE INDEX google_oauth_tenant_provider_key
  ON public.google_oauth_connections(tenant_id, provider);

CREATE TRIGGER google_oauth_connections_updated_at
  BEFORE UPDATE ON public.google_oauth_connections
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.google_oauth_connections ENABLE ROW LEVEL SECURITY;

-- Contiene una credencial: ni el equipo la lee. Solo admin/director, y en la práctica se accede
-- desde el servidor con service role. No hay política de SELECT para el equipo a propósito.
CREATE POLICY "google_oauth_admin_all" ON public.google_oauth_connections FOR ALL
  USING (is_admin_or_director())
  WITH CHECK (is_admin_or_director());

CREATE POLICY "google_oauth_tenant_isolation" ON public.google_oauth_connections AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
