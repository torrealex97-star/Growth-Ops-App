-- Round 2 of P0 security fixes, found via Supabase's own Security Advisor
-- after confirming the round-1 migration (20260911120000_fix_rls_p0.sql)
-- was never actually applied. Idempotent — safe to re-run.

-- ------------------------------------------------------------------
-- 1) positive_notes — re-apply (confirmed NOT applied: relrowsecurity=false)
-- ------------------------------------------------------------------
ALTER TABLE public.positive_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS positive_notes_select ON public.positive_notes;
CREATE POLICY positive_notes_select ON public.positive_notes FOR SELECT USING (
  user_id = auth.uid() OR is_shared = true
);

DROP POLICY IF EXISTS positive_notes_modify ON public.positive_notes;
CREATE POLICY positive_notes_modify ON public.positive_notes FOR ALL USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
);

-- ------------------------------------------------------------------
-- 2) vsl_videos / vsl_sessions — no RLS at all. The app itself always
--    reads/writes these via a privileged direct Postgres connection
--    (lib/vsl/db.ts, POSTGRES_URL — bypasses RLS regardless), so this
--    only closes the direct-PostgREST-with-anon-key exposure.
--    vsl_sessions in particular holds lead_email/lead_name for every
--    VSL viewer — currently readable by anyone holding the anon key.
-- ------------------------------------------------------------------
ALTER TABLE public.vsl_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsl_videos_select ON public.vsl_videos;
CREATE POLICY vsl_videos_select ON public.vsl_videos FOR SELECT USING (
  get_my_role() IN ('admin', 'director', 'manager', 'marketing', 'editor')
);

ALTER TABLE public.vsl_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsl_sessions_select ON public.vsl_sessions;
CREATE POLICY vsl_sessions_select ON public.vsl_sessions FOR SELECT USING (
  get_my_role() IN ('admin', 'director', 'manager', 'marketing', 'editor')
);
-- No INSERT/UPDATE policy on either: real writes go through the
-- privileged connection above, so PostgREST writes stay default-denied.

-- ------------------------------------------------------------------
-- 3) Function Search Path Mutable — SECURITY DEFINER functions without
--    a fixed search_path are vulnerable to search_path hijacking (a
--    caller could create objects in a schema earlier in their search
--    path to shadow calls made inside the function).
-- ------------------------------------------------------------------
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.get_my_role() SET search_path = public;
ALTER FUNCTION public.is_admin_or_director() SET search_path = public;
ALTER FUNCTION public.suggestions_set_resolved_at() SET search_path = public;
ALTER FUNCTION public.positive_notes_set_updated_at() SET search_path = public;

-- ------------------------------------------------------------------
-- 4) attribution_funnel() was callable by the `anon` role — anyone with
--    just the publishable/anon key (no login) could pull aggregated
--    lead/appointment/sales/revenue-by-source numbers. Restrict to
--    logged-in users only, matching its original intent ("función
--    agregada para adscripción").
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.attribution_funnel() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attribution_funnel() FROM anon;
GRANT EXECUTE ON FUNCTION public.attribution_funnel() TO authenticated;

-- Same tightening for the RLS-helper functions: they only need to be
-- callable by authenticated (used inside policies evaluated for logged-in
-- users) — anon never legitimately calls these directly.
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin_or_director() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_director() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_director() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_data_scope() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_data_scope() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_data_scope() TO authenticated;
