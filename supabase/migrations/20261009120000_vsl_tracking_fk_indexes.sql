-- VSL Intelligence PR-1d: índices de cobertura para relaciones canónicas.
-- Evitan scans completos al validar joins y al borrar/actualizar filas padre.

CREATE INDEX IF NOT EXISTS vsl_embed_locations_tenant_video_idx
  ON public.vsl_embed_locations (tenant_id, video_id);

CREATE INDEX IF NOT EXISTS vsl_playback_sessions_tenant_embed_idx
  ON public.vsl_playback_sessions (tenant_id, embed_location_id)
  WHERE embed_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vsl_playback_sessions_tenant_legacy_idx
  ON public.vsl_playback_sessions (tenant_id, legacy_session_id);

CREATE INDEX IF NOT EXISTS vsl_playback_sessions_tenant_version_idx
  ON public.vsl_playback_sessions (tenant_id, video_version_id);
