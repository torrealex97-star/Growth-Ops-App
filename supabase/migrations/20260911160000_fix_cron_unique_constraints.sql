-- BUGFIX (not routine hardening): the multi-tenant conversion in
-- 20260911150000_multi_tenant_domain_tables.sql added a NOT NULL tenant_id column
-- to integration_settings, ig_account_daily, ig_audience and ig_conversations_daily,
-- but left their pre-existing UNIQUE/PRIMARY KEY constraints as GLOBAL (not scoped
-- to tenant_id). Concretely, with two active tenants:
--
--   · integration_settings: PRIMARY KEY (key) — tenant B saving META_ACCESS_TOKEN
--     would upsert (onConflict 'key') straight over tenant A's row for the same key,
--     not create its own. This is a second angle on the cross-tenant credential leak
--     fixed in lib/config.ts (ensureConfig) in this same change — the cache fix alone
--     does not help if the underlying rows themselves collide.
--   · ig_account_daily / ig_conversations_daily: UNIQUE (snapshot_date) — two
--     tenants syncing Instagram on the same calendar day would upsert onto the SAME
--     row (whichever tenant wrote first "wins", the other's data is clobbered/merged).
--   · ig_audience: UNIQUE (dimension, bucket) — same problem, keyed by demographic
--     bucket instead of date.
--
-- Fix: rescope each constraint to include tenant_id. Application code in lib/config.ts,
-- app/api/[tenant]/evergreen/settings/integraciones/route.ts and lib/instagram/sync.ts
-- has already been updated to upsert with the new composite onConflict targets
-- ('tenant_id,key' / 'tenant_id,snapshot_date' / 'tenant_id,dimension,bucket') and to
-- filter reads by tenant_id — this migration makes the DB constraints match.
--
-- NOT applied to the live DB by the agent that wrote this file (no DB credentials in
-- this environment) — a human/CI step must run `supabase db push` (or equivalent)
-- to apply it before the corresponding app code reaches production, otherwise the
-- upserts below will fail with "no unique or exclusion constraint matching the
-- ON CONFLICT specification".

-- ── integration_settings: key PK → (tenant_id, key) ──────────────────────────
ALTER TABLE public.integration_settings DROP CONSTRAINT IF EXISTS integration_settings_pkey;
ALTER TABLE public.integration_settings ADD CONSTRAINT integration_settings_tenant_key_key UNIQUE (tenant_id, key);
-- Keep row identity fast to look up by key alone too (non-unique, used by no code path
-- today but cheap insurance for future single-key lookups/debugging).
CREATE INDEX IF NOT EXISTS integration_settings_key_idx ON public.integration_settings (key);

-- ── ig_account_daily: (snapshot_date) → (tenant_id, snapshot_date) ───────────
DROP INDEX IF EXISTS public.ig_account_daily_date_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ig_account_daily_tenant_date_idx ON public.ig_account_daily (tenant_id, snapshot_date);

-- ── ig_audience: (dimension, bucket) → (tenant_id, dimension, bucket) ────────
DROP INDEX IF EXISTS public.ig_audience_dim_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ig_audience_tenant_dim_idx ON public.ig_audience (tenant_id, dimension, bucket);

-- ── ig_conversations_daily: (snapshot_date) → (tenant_id, snapshot_date) ─────
DROP INDEX IF EXISTS public.ig_conversations_daily_date_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ig_conversations_daily_tenant_date_idx ON public.ig_conversations_daily (tenant_id, snapshot_date);

-- ── Tables deliberately LEFT AS-IS (reasoning) ────────────────────────────────
-- · campaign_ads.external_id UNIQUE, campaign_daily UNIQUE(campaign_id, date),
--   ig_media.external_id UNIQUE, fb_media.external_id UNIQUE, youtube_uploads.
--   ig_media_external_id UNIQUE: all keyed by an id that is GLOBALLY unique at the
--   source (Meta ad/campaign id, Instagram media id, Facebook reel id) or, for
--   campaign_daily, by campaign_id which is itself a UUID already scoped to one
--   tenant's row in `campaigns` — two tenants cannot produce the same key here in
--   practice, so no constraint change is needed there; the fix for those tables was
--   simply to stamp tenant_id on every insert/upsert (done in lib/meta/sync.ts,
--   lib/instagram/sync.ts, lib/youtube/backfill.ts) so new rows stop failing the
--   NOT NULL constraint.
-- · sequra_delinquent_customers.order_reference UNIQUE: the table has a CHECK
--   constraint hard-pinning merchant_reference = '[tenant]', i.e. it is only ever
--   populated by one tenant today; left as-is (stamping tenant_id was still added
--   to the sync so it satisfies the NOT NULL column).
-- · expenses (auto_source, period) UNIQUE: auto_source values written from
--   lib/meta/sync.ts are `campaign:<campaigns.id>` where campaigns.id is a UUID
--   already unique per tenant's own row, so no cross-tenant collision is possible.
