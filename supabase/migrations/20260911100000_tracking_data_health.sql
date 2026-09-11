-- Canonical tracking and data-health foundation.
-- Non-destructive: existing CRM, sales and attribution tables remain unchanged.

CREATE TABLE IF NOT EXISTS public.analytics_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id TEXT UNIQUE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id UUID REFERENCES public.analytics_visitors(id) ON DELETE SET NULL,
  external_session_id TEXT UNIQUE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  landing_url TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  gclid TEXT,
  fbclid TEXT,
  ttclid TEXT,
  raw_parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.analytics_touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id UUID REFERENCES public.analytics_visitors(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.analytics_sessions(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  channel TEXT NOT NULL DEFAULT 'unknown',
  source TEXT,
  medium TEXT,
  campaign TEXT,
  ad_set TEXT,
  ad TEXT,
  creative TEXT,
  landing_url TEXT,
  referrer TEXT,
  click_id_type TEXT,
  click_id TEXT,
  capture_method TEXT NOT NULL DEFAULT 'server',
  observation_type TEXT NOT NULL DEFAULT 'observed'
    CHECK (observation_type IN ('observed','inferred','modeled')),
  consent_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.canonical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  idempotency_key TEXT NOT NULL,
  visitor_id UUID REFERENCES public.analytics_visitors(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.analytics_sessions(id) ON DELETE SET NULL,
  touchpoint_id UUID REFERENCES public.analytics_touchpoints(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  revenue NUMERIC(14,2),
  currency TEXT,
  consent_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  properties JSONB NOT NULL DEFAULT '{}'::JSONB,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','matched','processed','rejected','pending')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, idempotency_key),
  UNIQUE (source, event_id)
);

CREATE TABLE IF NOT EXISTS public.identity_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.canonical_events(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','rejected','needs_review')),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.canonical_events(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','accepted','rejected','retrying','failed','deduplicated')),
  http_status INTEGER,
  latency_ms INTEGER,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  response_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, destination, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON public.analytics_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_occurred ON public.analytics_touchpoints(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_contact ON public.analytics_touchpoints(contact_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_occurred ON public.canonical_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_events_status ON public.canonical_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_identity_matches_status ON public.identity_matches(status);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_status ON public.delivery_attempts(status);

ALTER TABLE public.analytics_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_visitors_read ON public.analytics_visitors;
CREATE POLICY analytics_visitors_read ON public.analytics_visitors FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));
DROP POLICY IF EXISTS analytics_sessions_read ON public.analytics_sessions;
CREATE POLICY analytics_sessions_read ON public.analytics_sessions FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));
DROP POLICY IF EXISTS analytics_touchpoints_read ON public.analytics_touchpoints;
CREATE POLICY analytics_touchpoints_read ON public.analytics_touchpoints FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));
DROP POLICY IF EXISTS canonical_events_read ON public.canonical_events;
CREATE POLICY canonical_events_read ON public.canonical_events FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));
DROP POLICY IF EXISTS identity_matches_read ON public.identity_matches;
CREATE POLICY identity_matches_read ON public.identity_matches FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));
DROP POLICY IF EXISTS delivery_attempts_read ON public.delivery_attempts;
CREATE POLICY delivery_attempts_read ON public.delivery_attempts FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));

COMMENT ON TABLE public.canonical_events IS 'Canonical, idempotent business and tracking events. No demo data.';
COMMENT ON TABLE public.identity_matches IS 'Explainable identity-resolution candidates and decisions.';
COMMENT ON TABLE public.delivery_attempts IS 'PII-safe delivery diagnostics for advertising destinations.';
