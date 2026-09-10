-- ============================================================
-- MIGRACIÓN v49 — Flag de seguimiento en agenda
-- Idempotente.
-- ============================================================
-- El status 'seguimiento' (v48) es excluyente con el resto de estados de la
-- cita. Para poder marcar "en seguimiento" una cita que además ya se presentó,
-- fue no-show, etc. sin perder ese estado real, se añade un flag independiente.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS needs_followup boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_appointments_needs_followup
  ON public.appointments (needs_followup)
  WHERE needs_followup = true;

-- ============================================================
-- FIN v49
-- ============================================================
