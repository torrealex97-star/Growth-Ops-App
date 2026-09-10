-- Pipeline interno de seguimiento comercial para agendas que necesitan trabajo manual del equipo:
-- no-show a recontactar, asistió pero está negociando el pago, o quedó pendiente de una nueva
-- fecha reagendada. `followup_stage` es INDEPENDIENTE de `status` (que refleja el resultado real
-- de la cita: show/no_show/cancelled/etc) y también de `pipeline_stage` (texto libre que rellenan
-- las integraciones externas como GHL/Calendly) — no confundir ninguno de los dos con esta columna,
-- que es de uso exclusivo del equipo de ventas desde la app para triage manual.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS followup_stage TEXT
    CHECK (followup_stage IN ('pendiente_recontacto','en_seguimiento_pago','reagendado_pendiente','cerrado')),
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointments_followup_stage
  ON public.appointments(followup_stage) WHERE followup_stage IS NOT NULL;
