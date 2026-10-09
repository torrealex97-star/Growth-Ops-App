-- VSL Intelligence PR-1b: modelo aditivo para versiones, playbacks, eventos e intervalos.
-- No elimina ni reinterpreta vsl_sessions; el tracking anterior sigue siendo la compatibilidad.
-- Rollback seguro antes de conectar consumidores: DROP de estas tablas en orden inverso.

CREATE UNIQUE INDEX IF NOT EXISTS vsl_videos_tenant_id_id_key
  ON public.vsl_videos (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_id_id_key
  ON public.contacts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS vsl_sessions_tenant_id_id_key
  ON public.vsl_sessions (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.vsl_video_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  video_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  provider TEXT NOT NULL DEFAULT 'bunny' CHECK (provider IN ('bunny', 'external', 'legacy')),
  provider_video_id TEXT,
  source_url TEXT,
  duration_seconds NUMERIC NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, video_id, version_number),
  FOREIGN KEY (tenant_id, video_id)
    REFERENCES public.vsl_videos(tenant_id, id) ON DELETE CASCADE,
  CHECK (replaced_at IS NULL OR replaced_at >= published_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS vsl_video_versions_provider_key
  ON public.vsl_video_versions (tenant_id, provider, provider_video_id)
  WHERE provider_video_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vsl_embed_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  video_id UUID NOT NULL,
  video_version_id UUID NOT NULL,
  normalized_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'unknown',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, video_version_id, normalized_url, placement),
  FOREIGN KEY (tenant_id, video_id)
    REFERENCES public.vsl_videos(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, video_version_id)
    REFERENCES public.vsl_video_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.vsl_playback_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  video_id UUID NOT NULL,
  video_version_id UUID NOT NULL,
  embed_location_id UUID,
  legacy_session_id UUID,
  viewer_id TEXT NOT NULL,
  session_id UUID NOT NULL DEFAULT gen_random_uuid(),
  playback_id UUID NOT NULL DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  tracking_schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (tracking_schema_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, playback_id),
  FOREIGN KEY (tenant_id, video_id)
    REFERENCES public.vsl_videos(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, video_version_id)
    REFERENCES public.vsl_video_versions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, embed_location_id)
    REFERENCES public.vsl_embed_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, legacy_session_id)
    REFERENCES public.vsl_sessions(tenant_id, id),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS vsl_playback_sessions_video_started_idx
  ON public.vsl_playback_sessions (tenant_id, video_id, started_at DESC);
CREATE INDEX IF NOT EXISTS vsl_playback_sessions_viewer_started_idx
  ON public.vsl_playback_sessions (tenant_id, viewer_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.vsl_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  playback_id UUID NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'player_impression', 'player_ready', 'video_play', 'video_pause', 'video_resume',
    'video_seek', 'video_progress', 'video_complete', 'video_error',
    'video_buffer_start', 'video_buffer_end', 'video_cta_impression', 'video_cta_click',
    'video_form_view', 'video_form_submit', 'video_viewer_identified'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  playhead_seconds NUMERIC CHECK (playhead_seconds IS NULL OR playhead_seconds >= 0),
  duration_seconds NUMERIC CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  playback_rate NUMERIC CHECK (playback_rate IS NULL OR playback_rate > 0),
  visibility_state TEXT CHECK (visibility_state IS NULL OR visibility_state IN ('visible', 'hidden')),
  source TEXT NOT NULL DEFAULT 'growth_ops_player',
  schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, playback_id)
    REFERENCES public.vsl_playback_sessions(tenant_id, playback_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vsl_tracking_events_playback_time_idx
  ON public.vsl_tracking_events (tenant_id, playback_id, occurred_at, received_at);
CREATE INDEX IF NOT EXISTS vsl_tracking_events_video_type_time_idx
  ON public.vsl_tracking_events (tenant_id, event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.vsl_watch_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  playback_id UUID NOT NULL,
  batch_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  start_second NUMERIC NOT NULL CHECK (start_second >= 0),
  end_second NUMERIC NOT NULL CHECK (end_second > start_second),
  playback_rate NUMERIC NOT NULL DEFAULT 1 CHECK (playback_rate > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, playback_id, batch_id, sequence_number),
  FOREIGN KEY (tenant_id, playback_id)
    REFERENCES public.vsl_playback_sessions(tenant_id, playback_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vsl_watch_intervals_playback_range_idx
  ON public.vsl_watch_intervals (tenant_id, playback_id, start_second, end_second);

CREATE TABLE IF NOT EXISTS public.vsl_viewer_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL,
  contact_id UUID NOT NULL,
  link_source TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, viewer_id, contact_id),
  FOREIGN KEY (tenant_id, contact_id)
    REFERENCES public.contacts(tenant_id, id) ON DELETE CASCADE,
  CHECK (revoked_at IS NULL OR revoked_at >= linked_at)
);

CREATE INDEX IF NOT EXISTS vsl_viewer_identities_contact_idx
  ON public.vsl_viewer_identities (tenant_id, contact_id, linked_at DESC);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vsl_video_versions', 'vsl_embed_locations', 'vsl_playback_sessions',
    'vsl_tracking_events', 'vsl_watch_intervals', 'vsl_viewer_identities'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (' ||
      'tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))',
      table_name || '_select', table_name
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.vsl_tracking_events IS
  'Eventos VSL canónicos e idempotentes; no contiene IP completa ni PII del formulario.';
COMMENT ON TABLE public.vsl_watch_intervals IS
  'Intervalos realmente reproducidos [start_second, end_second); no se rellenan huecos de seek.';
COMMENT ON COLUMN public.vsl_embed_locations.normalized_url IS
  'URL normalizada sin parámetros sensibles; los UTMs se modelan fuera de esta tabla.';
