-- v40 — Tracking de onboarding del alumno (webhooks entrantes de GHL)
--   onboarding_scheduled_at : cuándo el alumno AGENDÓ su sesión de onboarding
--                             (marca el estado "Onboarding agendado" en el pipeline).
--   onboarding_session_at   : fecha/hora de la sesión de onboarding reservada.
-- El click en la landing de accesos se guarda en contracts.accesos_abiertos_at (ya existe).

alter table sales add column if not exists onboarding_scheduled_at timestamptz;
alter table sales add column if not exists onboarding_session_at timestamptz;
