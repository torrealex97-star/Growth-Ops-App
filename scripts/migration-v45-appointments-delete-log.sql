-- v45 — Borrado de agendas duplicadas (solo admin).
-- Las agendas duplicadas (reagendas antiguas, dobles entradas de Calendly/GHL) ensucian los KPIs
-- de shows/no-shows. Como TODOS los KPIs leen directamente de public.appointments, la única forma
-- de que una duplicada deje de contar en todas partes es borrar la fila; un "soft delete" obligaría
-- a filtrar en ~15 pantallas y cualquier olvido seguiría inflando métricas.
-- Para que el borrado no sea irreversible, cada fila borrada se guarda aquí como snapshot JSON.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.deleted_appointments_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL,               -- id original (sin FK: la fila ya no existe)
  contact_id   UUID,
  snapshot     JSONB NOT NULL,                -- la fila completa tal cual estaba
  reason       TEXT,
  deleted_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deleted_appointments_log_appt_idx ON public.deleted_appointments_log (appointment_id);
CREATE INDEX IF NOT EXISTS deleted_appointments_log_date_idx ON public.deleted_appointments_log (deleted_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Solo lectura para dirección; las escrituras las hace el endpoint con service-role (salta RLS).
ALTER TABLE public.deleted_appointments_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deleted_appointments_log_select ON public.deleted_appointments_log;
CREATE POLICY deleted_appointments_log_select ON public.deleted_appointments_log FOR SELECT
  USING (is_admin_or_director());
