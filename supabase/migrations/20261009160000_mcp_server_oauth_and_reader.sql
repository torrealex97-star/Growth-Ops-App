-- Servidor MCP propio: OAuth 2.1 + acceso SQL read-only bajo RLS.
-- El rol `mcp_reader` NO puede login y su único privilegio es SELECT sobre las tablas de
-- negocio. Las credenciales OAuth viven en tres tablas que solo toca el servidor (service_role);
-- el usuario autenticado ve únicamente SUS clientes y sesiones (RLS por owner_user_id).
-- Nunca se concede INSERT/UPDATE/DELETE a mcp_reader: el servidor MCP es de solo lectura por
-- diseño y cualquier escritura sigue siendo exclusiva de las rutas de la app.

-- ------------------------------------------------------------------
-- 1) Rol lector, sin login y sin nada por defecto
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_reader') THEN
    CREATE ROLE mcp_reader NOLOGIN;
  END IF;
END $$;
REVOKE ALL ON SCHEMA public FROM mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;

-- ------------------------------------------------------------------
-- 2) Tablas OAuth (propietario: service_role; usuario ve las suyas vía RLS)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         TEXT NOT NULL UNIQUE CHECK (char_length(client_id) BETWEEN 16 AND 128),
  client_secret_hash TEXT NOT NULL,            -- sha256 hex; nunca se guarda el secreto en claro
  name              TEXT NOT NULL,
  -- Nulo hasta que un usuario aprueba el consentimiento en authorize; ese momento fija el dueño.
  -- Un cliente sin dueño no puede emitir tokens (authorize lo exige con sesión).
  owner_user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uris     TEXT[] NOT NULL,           -- coincidencia EXACTA contra la lista registrada
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash         TEXT NOT NULL UNIQUE,      -- sha256 hex del código de autorización
  client_id         TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uri      TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'read',
  code_challenge    TEXT NOT NULL,             -- S256 obligatorio (OAuth 2.1: sin PKCE no hay token)
  code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        TEXT NOT NULL UNIQUE,      -- sha256 hex del access token
  refresh_hash      TEXT UNIQUE,               -- sha256 hex del refresh token (rotación)
  client_id         TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL DEFAULT 'read',
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_client_idx ON public.mcp_oauth_codes(client_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_client_idx ON public.mcp_oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_refresh_idx ON public.mcp_oauth_tokens(refresh_hash) WHERE refresh_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_clients_owner_idx ON public.mcp_oauth_clients(owner_user_id);

-- RLS: el propietario lista/borra SUS clientes y sesiones (futuras pantallas de gestión);
-- las demás operaciones viven en el servidor con service_role.
ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_clients_owner_select ON public.mcp_oauth_clients;
CREATE POLICY mcp_clients_owner_select ON public.mcp_oauth_clients
  FOR SELECT TO authenticated
  USING (owner_user_id = (select auth.uid()));

DROP POLICY IF EXISTS mcp_clients_owner_delete ON public.mcp_oauth_clients;
CREATE POLICY mcp_clients_owner_delete ON public.mcp_oauth_clients
  FOR DELETE TO authenticated
  USING (owner_user_id = (select auth.uid()));

DROP POLICY IF EXISTS mcp_codes_owner_select ON public.mcp_oauth_codes;
CREATE POLICY mcp_codes_owner_select ON public.mcp_oauth_codes
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS mcp_tokens_owner_select ON public.mcp_oauth_tokens;
CREATE POLICY mcp_tokens_owner_select ON public.mcp_oauth_tokens
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- ------------------------------------------------------------------
-- 3) Privilegios del rol lector: SELECT sobre tablas de negocio con RLS.
--    La lista se mantiene explícita: añadir una tabla nueva NO expone datos solos.
-- ------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'tenants','users','contacts','appointments','sales','collections','payment_plans',
    'refunds','commissions','affiliate_campaigns','affiliate_clicks','contract_templates',
    'contracts','campaigns','ad_sets','campaign_targets','campaign_metrics','contact_attributions',
    'funnels','funnel_steps','canonical_events','raw_events','event_types','integration_sync_runs',
    'vsl_video_versions','vsl_playback_sessions','vsl_tracking_events','vsl_watch_intervals',
    'vsl_viewer_identities','stripe_payments','integration_settings','goals'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO mcp_reader', t);
    END IF;
  END LOOP;
END $$;

-- El rol lector NO ve las tablas OAuth ni funciones de auth de Supabase.
REVOKE ALL ON TABLE public.mcp_oauth_clients, public.mcp_oauth_codes, public.mcp_oauth_tokens FROM mcp_reader;
