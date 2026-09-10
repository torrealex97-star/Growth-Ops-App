-- ============================================================
-- MIGRACIÓN v48 — Etiquetas de agenda "Seguimiento" y "Reserva"
-- Idempotente.
-- ============================================================
-- Sugerencia del equipo: al etiquetar una agenda faltan las opciones
-- "seguimiento" y "reserva" (distintas del lead_status del contacto,
-- que ya las tenía desde antes). Se amplía el CHECK de appointments.status
-- siguiendo el mismo patrón que la migración v3.

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    'scheduled','confirmed','show','no_show','cancelled','rescheduled',
    'completed','cancelled_admin','cancelled_lead','seguimiento','reserva'
  ));

-- ============================================================
-- FIN v48
-- ============================================================
