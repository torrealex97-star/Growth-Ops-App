-- Si al reprogramar una agenda enlazada a Calendly falla la cancelación del evento antiguo
-- (rate limit / red, ver app/api/evergreen/appointments/reschedule/route.ts), el evento viejo
-- queda vivo en Calendly/Google Calendar y provoca un duplicado. Antes solo se logueaba en
-- consola; ahora se persiste para que un cron pueda reintentar la cancelación más tarde.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendly_cleanup_pending BOOLEAN DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendly_cleanup_event_uuid TEXT;

CREATE INDEX IF NOT EXISTS appointments_calendly_cleanup_pending_idx
  ON public.appointments(calendly_cleanup_pending) WHERE calendly_cleanup_pending = true;
