-- social_research — capa normalizada de INVESTIGACIÓN EXTERNA (Apify u otro proveedor).
--
-- BRIEF (§10, §11, §17): la cuenta propia de Instagram se gestiona EXCLUSIVAMENTE con la API
-- oficial de Meta (lib/instagram/*, Graph API). Esta capa almacena lo que llega del proveedor
-- externo desacoplado: perfiles/posts PÚBLICOS de terceros para investigación, competidores,
-- benchmarking. NUNCA recibe credenciales de la cuenta propia (§17) y la app consume SOLO estos
-- modelos normalizados, nunca el JSON crudo del Actor (§11).
--
-- Multicanal desde el día 1 (§19): platform = instagram | tiktok | youtube.
-- Aislamiento multitenant: tenant_id + policies solo-rol (patrón 20260919110000).

CREATE TABLE IF NOT EXISTS public.social_research_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform             TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  provider             TEXT NOT NULL DEFAULT 'apify',
  job_type             TEXT NOT NULL CHECK (job_type IN ('profile', 'reels', 'posts', 'videos')),
  actor_id             TEXT,                          -- actor del proveedor usado en esta ejecución
  provider_run_id      TEXT,                          -- runId del proveedor (Apify: run.id)
  provider_dataset_id  TEXT,                          -- defaultDatasetId del proveedor
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'aborted')),
  input_json           JSONB,                         -- input normalizado NUESTRO (usernames, limit...)
  idempotency_key      TEXT,                          -- dedupe de dobles submits del frontend
  records_processed    INTEGER NOT NULL DEFAULT 0,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
);

-- Dos webhooks del mismo run no crean dos trabajos; y el mismo idempotency_key de un tenant
-- tampoco. El índice es parcial: NULL nunca choca con NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sri_provider_run
  ON public.social_research_jobs(provider, provider_run_id) WHERE provider_run_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sri_idempotency
  ON public.social_research_jobs(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sri_tenant ON public.social_research_jobs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.social_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  external_id      TEXT,                            -- no siempre el proveedor lo trae; UNIQUE condicional
  username         TEXT NOT NULL,
  display_name     TEXT,
  profile_url      TEXT,
  avatar_url       TEXT,
  followers_count  BIGINT,
  following_count  BIGINT,
  posts_count      BIGINT,
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  biography        TEXT,                            -- mínimo necesario; PII de terceros: solo público (§18)
  metadata_json    JSONB,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source           TEXT NOT NULL DEFAULT 'apify',
  job_id           UUID REFERENCES public.social_research_jobs(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, platform, username)            -- un perfil por plataforma y tenant
);

CREATE INDEX IF NOT EXISTS idx_sp_tenant  ON public.social_profiles(tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_sp_job     ON public.social_profiles(job_id);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  external_id       TEXT NOT NULL,                  -- shortcode/id del post en la plataforma
  profile_id        UUID REFERENCES public.social_profiles(id) ON DELETE CASCADE,
  content_type      TEXT,                           -- reel | post | carousel | video (según plataforma)
  caption           TEXT,
  post_url          TEXT,
  media_url         TEXT,
  thumbnail_url     TEXT,
  published_at      TIMESTAMPTZ,
  views_count       BIGINT,
  likes_count       BIGINT,
  comments_count    BIGINT,
  shares_count      BIGINT,
  duration_seconds  NUMERIC,
  metadata_json     JSONB,
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source            TEXT NOT NULL DEFAULT 'apify',
  job_id            UUID REFERENCES public.social_research_jobs(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_spo_tenant   ON public.social_posts(tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_spo_profile  ON public.social_posts(profile_id);
CREATE INDEX IF NOT EXISTS idx_spo_job      ON public.social_posts(job_id);
CREATE INDEX IF NOT EXISTS idx_spo_published ON public.social_posts(published_at DESC);

-- RAW del proveedor (§11): solo para debugging/compatibilidad. La app NUNCA lee de aquí.
CREATE TABLE IF NOT EXISTS public.social_raw_payloads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES public.social_research_jobs(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_srp_job ON public.social_raw_payloads(job_id);

-- Retención (§18): el raw se purga a los 30 días (aplicable manualmente o por cron futuro;
-- se deja documentado aquí para no convertirlo en dato permanente por accidente).
--   DELETE FROM public.social_raw_payloads WHERE created_at < NOW() - INTERVAL '30 days';

ALTER TABLE public.social_research_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_raw_payloads   ENABLE ROW LEVEL SECURITY;

-- Policies solo-rol (patrón de la remediación). Los endpoints usan service_role (bypasean RLS);
-- estas policies protegen el acceso directo de clientes authenticated.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_research_jobs', 'social_profiles', 'social_posts', 'social_raw_payloads']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())',
      t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
         WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())',
      t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
         USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
         WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())',
      t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
         USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())',
      t || '_delete', t);
  END LOOP;
END $$;
