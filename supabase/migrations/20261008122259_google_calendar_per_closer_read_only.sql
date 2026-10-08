-- Google Calendar por closer: conexión individual y selección de calendarios.
--
-- La agenda comercial canónica sigue siendo public.appointments. Esta migración solo amplía la
-- infraestructura OAuth existente y guarda QUÉ calendarios debe observar cada closer. La ingesta
-- de eventos y la conciliación llegan en la fase siguiente; no se crean agendas ni KPIs aquí.

ALTER TABLE public.google_oauth_connections
  DROP CONSTRAINT IF EXISTS google_oauth_connections_provider_check;

ALTER TABLE public.google_oauth_connections
  ADD CONSTRAINT google_oauth_connections_provider_check
  CHECK (provider IN ('ga4', 'gmail', 'calendar'));

ALTER TABLE public.google_oauth_connections
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.google_oauth_connections.owner_user_id IS
  'Propietario funcional de una conexión individual. Obligatorio para provider=calendar; GA4/Gmail siguen siendo conexiones del tenant.';

ALTER TABLE public.google_oauth_connections
  ADD CONSTRAINT google_oauth_calendar_requires_owner
  CHECK (provider <> 'calendar' OR owner_user_id IS NOT NULL);

-- El índice anterior bloqueaba una segunda conexión Calendar dentro del mismo tenant. Se conserva
-- su garantía para GA4/Gmail mediante un índice parcial y Calendar añade una conexión por miembro.
DROP INDEX IF EXISTS public.google_oauth_tenant_provider_key;
CREATE UNIQUE INDEX google_oauth_tenant_provider_key
  ON public.google_oauth_connections (tenant_id, provider)
  WHERE provider IN ('ga4', 'gmail');

CREATE UNIQUE INDEX IF NOT EXISTS google_oauth_tenant_provider_owner_key
  ON public.google_oauth_connections (tenant_id, provider, owner_user_id);

CREATE INDEX IF NOT EXISTS google_oauth_owner_lookup_idx
  ON public.google_oauth_connections (tenant_id, owner_user_id, provider)
  WHERE owner_user_id IS NOT NULL;

CREATE TABLE public.google_connected_calendars (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id        UUID NOT NULL REFERENCES public.google_oauth_connections(id) ON DELETE CASCADE,
  owner_user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  external_calendar_id TEXT NOT NULL,
  calendar_name        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('primary', 'conflict', 'read_only')),
  time_zone            TEXT,
  is_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at         TIMESTAMPTZ,
  last_error_code      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connection_id, external_calendar_id)
);

-- Una única fuente de destino/principal por conexión. Los calendarios de conflicto y solo lectura
-- pueden ser varios. Este índice también protege frente a dos requests simultáneos de selección.
CREATE UNIQUE INDEX google_connected_calendars_one_primary
  ON public.google_connected_calendars (connection_id)
  WHERE role = 'primary' AND is_enabled;

CREATE INDEX google_connected_calendars_owner_idx
  ON public.google_connected_calendars (tenant_id, owner_user_id, role)
  WHERE is_enabled;

CREATE TRIGGER google_connected_calendars_updated_at
  BEFORE UPDATE ON public.google_connected_calendars
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.google_connected_calendars ENABLE ROW LEVEL SECURITY;

-- No se concede acceso directo del closer a google_oauth_connections: contiene el refresh token
-- cifrado y se opera exclusivamente mediante rutas servidoras. Los calendarios seleccionados no
-- contienen secretos y sí se pueden leer por su dueño; solo dueño o liderazgo pueden modificarlos.
CREATE POLICY google_connected_calendars_select ON public.google_connected_calendars
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT public.auth_tenant_ids())
    AND (owner_user_id = auth.uid() OR public.is_tenant_admin(tenant_id))
  );

CREATE POLICY google_connected_calendars_modify ON public.google_connected_calendars
  FOR ALL TO authenticated
  USING (
    tenant_id IN (SELECT public.auth_tenant_ids())
    AND (owner_user_id = auth.uid() OR public.is_tenant_admin(tenant_id))
  )
  WITH CHECK (
    tenant_id IN (SELECT public.auth_tenant_ids())
    AND (owner_user_id = auth.uid() OR public.is_tenant_admin(tenant_id))
  );
