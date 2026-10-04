-- appointments.ghl_calendar_id — puente calendario GHL → dueño (closer) en la sync por pull.
--
-- POR QUÉ. Los eventos que llegan por la sincronización (cron/botón) NO traen usuario asignado:
-- el payload de GET /calendars/events solo incluye calendarId (verificado en los raw_payload de
-- producción). El webhook de GHL sí trae el email del usuario asignado, pero el pull es la fuente
-- principal (el webhook es puntual) y dejaba TODA su agenda sin closer — y sin closer no hay
-- atribución de comisiones ni agenda por rep. La identidad del dueño vive en el CALENDARIO
-- (assignedUserId), no en el evento: se guarda aquí la FK del calendario para poder (a) mapear
-- calendario→usuario en la sync sin backfill masivo de users, y (b) re-mapear si cambia el dueño.
--
-- PUENTE, NO FK DURA a un catálogo nuevo: el id es el de GHL (texto). Con FK a una tabla local de
-- calendarios duplicaríamos el catálogo; el mapeo calendario→usuario de la app se resuelve en
-- código por el email del usuario GHL (GET /users/{assignedUserId}) filtrado por membresía
-- (firstMemberOf), igual que el webhook resuelve por email. Sin dueño mapeado, la columna queda
-- y la cita queda sin closer: un hueco no se disimula con una asignación inventada.
--
-- NULLABLE e idempotente: solo citas de GHL lo tienen; re-ejecutar no toca nada (IF NOT EXISTS).

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ghl_calendar_id TEXT;

-- Lectura canónica de la sync: dado un external_id (evento) se quiere la fila con su calendario;
-- y la backfill de eventos existentes se hace por (tenant_id, external_source) filtrando calendario.
CREATE INDEX IF NOT EXISTS idx_appointments_ghl_calendar
  ON public.appointments (tenant_id, ghl_calendar_id)
  WHERE ghl_calendar_id IS NOT NULL;
