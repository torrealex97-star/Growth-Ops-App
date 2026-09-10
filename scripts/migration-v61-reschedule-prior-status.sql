-- v61 — Guarda si una agenda reagendada venía de un No show o de un Show.
-- Bug: /appointments/reschedule sobreescribe la MISMA fila y resetea status a
-- 'scheduled', así que se perdía si la cita reagendada era porque el lead no
-- se presentó (no_show) o porque sí se presentó y se agenda una siguiente
-- llamada (show). Solo quedaba una nota de texto genérica en `activities`.
-- `rescheduled_from_status` guarda el status justo antes de esa reprogramación,
-- para poder distinguir "Reagenda / No show" de "Reagenda / Show" en el
-- historial de citas del contacto.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS rescheduled_from_status TEXT;
