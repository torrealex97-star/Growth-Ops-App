-- P0 security fixes found in the 2026-09-11 architecture audit (docs/AUDITORIA-FASE1-2026-09-11.md).
-- Idempotent — safe to re-run.

-- ------------------------------------------------------------------
-- 1) collections: a later migration (v5, "garantizar SELECT para
--    cualquier rol autenticado") re-added a fully permissive SELECT
--    policy (collections_select_team) alongside the scoped one
--    (collections_select_scope) added earlier. Since Postgres RLS
--    OR's multiple permissive policies together, the permissive one
--    wins and defeats the scoping entirely. Drop it — the scoped
--    policy already covers cobros/gestoria/leadership via
--    is_admin_or_director() / my_data_scope() = 'team'.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS collections_select_team ON public.collections;

-- ------------------------------------------------------------------
-- 2) data_scope default: it defaulted to 'team', which means every
--    new user — including low-trust roles like affiliate/cold_caller —
--    gets full-company visibility on sales/contacts/collections/
--    contact_attributions unless an admin manually flips them to
--    'own'. Flip the default to 'own' (secure by default) and
--    backfill 'team' only for roles that legitimately need
--    company-wide visibility for their job.
-- ------------------------------------------------------------------
ALTER TABLE public.users ALTER COLUMN data_scope SET DEFAULT 'own';

UPDATE public.users u
SET data_scope = 'team'
WHERE data_scope = 'own'  -- don't clobber any 'own' already set intentionally
  AND EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = u.role_id
      AND r.key IN ('admin', 'director', 'manager', 'setter', 'closer', 'triager', 'cobros', 'gestoria')
  );

-- Keep the trigger/helper in sync — new users get 'own' by default from now on;
-- app code (invite/user-create flows) should explicitly set data_scope='team'
-- for setter/closer/triager/cobros/gestoria at creation time going forward.

-- ------------------------------------------------------------------
-- 3) positive_notes had no RLS at all (by design, per the original
--    comment: "todo el acceso pasa por /api/evergreen/positive-notes
--    con la service role"). That's not real security — anyone with a
--    valid Supabase anon-key session can query the table directly via
--    PostgREST, bypassing the API route entirely, and read/write any
--    user's private notes. Enable RLS with the same rule the API
--    route already enforces: own rows, or shared-wall rows for read.
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
