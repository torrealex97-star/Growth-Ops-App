-- VSL Intelligence PR-1c: acceso mínimo para la telemetría canónica.
-- La ingesta pública siempre pasa por rutas server-side; nunca escribe por PostgREST.

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vsl_video_versions', 'vsl_embed_locations', 'vsl_playback_sessions',
    'vsl_tracking_events', 'vsl_watch_intervals', 'vsl_viewer_identities'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (' ||
      'tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))',
      table_name || '_select', table_name
    );
  END LOOP;
END $$;
