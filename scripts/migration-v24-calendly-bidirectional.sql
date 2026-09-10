-- migration-v24: sincronización bidireccional con Calendly
-- Índice único sobre appointments.external_id para que la creación desde la app
-- (POST /invitees) y el webhook invitee.created reconcilien la misma cita en vez
-- de duplicarla. Los NULL siguen permitiéndose (varias citas manuales sin
-- external_id): en Postgres los NULL se consideran distintos en un índice UNIQUE.

CREATE UNIQUE INDEX IF NOT EXISTS appointments_external_id_key
  ON appointments (external_id);
