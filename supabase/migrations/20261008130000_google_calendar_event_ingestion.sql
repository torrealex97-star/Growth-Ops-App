-- Google Calendar Fase 2: inventario externo idempotente, todavía fuera de appointments/KPIs.

ALTER TABLE public.google_connected_calendars
  ADD COLUMN IF NOT EXISTS sync_token TEXT,
  ADD COLUMN IF NOT EXISTS last_full_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_incremental_sync_at TIMESTAMPTZ;

CREATE TABLE public.google_calendar_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connected_calendar_id UUID NOT NULL REFERENCES public.google_connected_calendars(id) ON DELETE CASCADE,
  owner_user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider_event_id     TEXT NOT NULL,
  ical_uid              TEXT,
  recurring_event_id    TEXT,
  original_start_at     TIMESTAMPTZ,
  event_start_at        TIMESTAMPTZ,
  event_end_at          TIMESTAMPTZ,
  time_zone             TEXT,
  status                TEXT NOT NULL CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
  visibility            TEXT,
  transparency          TEXT,
  attendee_fingerprints TEXT[] NOT NULL DEFAULT '{}',
  has_external_attendee BOOLEAN NOT NULL DEFAULT FALSE,
  is_all_day            BOOLEAN NOT NULL DEFAULT FALSE,
  external_updated_at   TIMESTAMPTZ,
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connected_calendar_id, provider_event_id)
);

COMMENT ON TABLE public.google_calendar_events IS
  'Inventario mínimo de eventos Google. No es agenda comercial y nunca alimenta KPIs directamente.';
COMMENT ON COLUMN public.google_calendar_events.attendee_fingerprints IS
  'HMAC irreversible de emails normalizados; nunca persiste emails de invitados en claro.';

CREATE INDEX google_calendar_events_owner_time_idx
  ON public.google_calendar_events (tenant_id, owner_user_id, event_start_at DESC);
CREATE INDEX google_calendar_events_calendar_seen_idx
  ON public.google_calendar_events (connected_calendar_id, last_seen_at DESC);
CREATE INDEX google_calendar_events_ical_idx
  ON public.google_calendar_events (tenant_id, ical_uid)
  WHERE ical_uid IS NOT NULL;

CREATE TRIGGER google_calendar_events_updated_at
  BEFORE UPDATE ON public.google_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.google_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_calendar_events_select ON public.google_calendar_events
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT public.auth_tenant_ids())
    AND (owner_user_id = (SELECT auth.uid()) OR public.is_tenant_admin(tenant_id))
  );

-- La ingesta usa service role. No se concede escritura directa al navegador para impedir que un
-- usuario fabrique eventos externos o altere futuras conciliaciones.
