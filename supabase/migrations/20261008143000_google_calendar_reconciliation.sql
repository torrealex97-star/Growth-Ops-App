-- Google Calendar Fase 3: enlace explicable con la agenda canónica.
-- Nunca crea appointments ni convierte eventos externos en métricas.

ALTER TABLE public.google_calendar_events
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS match_method TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_reason TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE public.google_calendar_events
  DROP CONSTRAINT IF EXISTS google_calendar_events_reconciliation_status_check;

ALTER TABLE public.google_calendar_events
  ADD CONSTRAINT google_calendar_events_reconciliation_status_check
  CHECK (reconciliation_status IN (
    'PENDING',
    'GOOGLE_ONLY',
    'MATCHED',
    'POSSIBLE_DUPLICATE',
    'TIME_MISMATCH',
    'CLOSER_MISMATCH',
    'STATUS_MISMATCH',
    'CONTACT_MISSING',
    'IGNORED_PRIVATE',
    'SYNC_ERROR'
  ));

CREATE INDEX IF NOT EXISTS google_calendar_events_reconciliation_idx
  ON public.google_calendar_events (tenant_id, reconciliation_status, event_start_at DESC);

CREATE INDEX IF NOT EXISTS google_calendar_events_appointment_idx
  ON public.google_calendar_events (appointment_id)
  WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN public.google_calendar_events.appointment_id IS
  'Agenda canónica enlazada con evidencia fuerte; no convierte el evento externo en una agenda.';
COMMENT ON COLUMN public.google_calendar_events.reconciliation_reason IS
  'Motivo técnico sin PII para explicar por qué se enlazó o quedó pendiente.';

CREATE OR REPLACE FUNCTION public.apply_google_calendar_reconciliation(
  p_tenant_id UUID,
  p_owner_user_id UUID,
  p_rows JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows debe ser un array JSON';
  END IF;

  WITH decisions AS (
    SELECT
      x.id,
      x.appointment_id,
      x.reconciliation_status,
      x.match_method,
      x.reconciliation_reason
    FROM jsonb_to_recordset(p_rows) AS x(
      id UUID,
      appointment_id UUID,
      reconciliation_status TEXT,
      match_method TEXT,
      reconciliation_reason TEXT
    )
  )
  UPDATE public.google_calendar_events AS event
  SET appointment_id = decisions.appointment_id,
      reconciliation_status = decisions.reconciliation_status,
      match_method = decisions.match_method,
      reconciliation_reason = decisions.reconciliation_reason,
      reconciled_at = NOW()
  FROM decisions
  WHERE event.id = decisions.id
    AND event.tenant_id = p_tenant_id
    AND event.owner_user_id = p_owner_user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_google_calendar_reconciliation(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_google_calendar_reconciliation(UUID, UUID, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_google_calendar_reconciliation(UUID, UUID, JSONB) TO service_role;
