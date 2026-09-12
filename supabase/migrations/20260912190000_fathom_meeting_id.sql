-- Fathom hoy se vincula a una reunión por email+ventana horaria de ±12h (history-sync),
-- sin ningún ID estable de la llamada — un re-sync no es idempotente (puede reprocesar la
-- misma llamada dos veces) y, si un contacto tuvo dos reuniones en esa ventana, no hay forma
-- de saber a cuál pertenece un re-sync posterior. Guardamos el ID real de la reunión de Fathom
-- para hacer el sync idempotente (saltar llamadas ya importadas).

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS fathom_meeting_id TEXT;
CREATE INDEX IF NOT EXISTS appointments_fathom_meeting_idx ON public.appointments(fathom_meeting_id)
  WHERE fathom_meeting_id IS NOT NULL;
