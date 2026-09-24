-- F6 — `fathom_match_review` pasa a ser alcanzable desde un contacto.
--
-- EL PROBLEMA. La tabla guarda `invitee_email`: el correo de la persona que aparecía en una reunión
-- de Fathom que el sync no supo emparejar con una cita. Son 177 filas con dato real y ninguna
-- referencia a `contacts`, así que `erase_person` —que es un comando por `contact_id`— no las
-- alcanza. Borrar a una persona dejaría su correo aquí, y el informe de borrado diría que todo fue
-- bien. Ver `docs/F6-MAPA-PII.md` §1.2.
--
-- POR QUÉ NO BASTA CON LA CITA. `resolved_appointment_id` daría el camino
-- (cita → contacto), pero hoy las 177 filas están SIN resolver: la cola nunca se ha vaciado. Ese
-- camino existe para el futuro, no para los datos que ya hay.
--
-- LO QUE ESTA MIGRACIÓN LOGRA, Y LO QUE NO. El backfill por correo normalizado empareja **69 de las
-- 177** filas. Las otras 108 llevan correos de personas que NO son contactos: nadie las dio de alta,
-- solo aparecieron en una reunión. Para esas, `contact_id` seguirá a NULL y ningún borrado por
-- contacto puede alcanzarlas por definición. No se disimula con un valor inventado: la columna queda
-- nullable a propósito y `erase_person` cubre ese resto borrando además por correo dentro de la
-- subcuenta. Lo estructural —que la cola acumule correos de gente sin ficha— es una decisión de
-- retención, no algo que arregle una FK.
--
-- Patrón EXPAND → BACKFILL → VERIFY (`docs/plan/01-arquitectura-datos.md` §9). No hay ENFORCE:
-- poner NOT NULL rompería las 108 filas legítimas sin contacto.

-- ── EXPAND ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fathom_match_review
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fathom_match_review.contact_id IS
  'Contacto al que pertenece invitee_email, cuando existe ficha. NULL = la persona no es contacto, '
  'así que erase_person no la alcanza por este camino y la cubre por correo. Ver docs/F6-MAPA-PII.md.';

-- ── BACKFILL (idempotente y reanudable: solo toca filas aún sin resolver) ─────────────────────
-- Prioridad 1: la cita ya resuelta manda, porque es un emparejamiento que revisó una persona.
UPDATE public.fathom_match_review f
SET contact_id = a.contact_id
FROM public.appointments a
WHERE f.contact_id IS NULL
  AND f.resolved_appointment_id IS NOT NULL
  AND a.id = f.resolved_appointment_id
  AND a.tenant_id = f.tenant_id          -- nunca cruzar subcuentas, ni siquiera por un id conocido
  AND a.contact_id IS NOT NULL;

-- Prioridad 2: correo normalizado, SIEMPRE dentro de la misma subcuenta. Se exige coincidencia
-- única: si dos contactos de la subcuenta comparten correo normalizado (no debería, hay índice
-- único parcial, pero un merge a medias podría dejarlo), se prefiere no vincular a vincular mal.
UPDATE public.fathom_match_review f
SET contact_id = c.id
FROM public.contacts c
WHERE f.contact_id IS NULL
  AND f.invitee_email IS NOT NULL
  AND c.tenant_id = f.tenant_id
  AND c.email_normalized = lower(btrim(f.invitee_email))
  AND c.merged_into IS NULL              -- nunca apuntar a un contacto absorbido por un merge
  AND (
    SELECT count(*) FROM public.contacts c2
    WHERE c2.tenant_id = f.tenant_id
      AND c2.email_normalized = lower(btrim(f.invitee_email))
      AND c2.merged_into IS NULL
  ) = 1;

-- ── ÍNDICE ────────────────────────────────────────────────────────────────────────────────────
-- erase_person consulta por (tenant_id, contact_id); sin índice sería un seq scan por cada borrado.
CREATE INDEX IF NOT EXISTS fathom_match_review_tenant_contact_idx
  ON public.fathom_match_review (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- ── VERIFY ────────────────────────────────────────────────────────────────────────────────────
-- Falla en voz alta si el backfill no vinculó nada habiendo correos que casaban: significaría que
-- la normalización cambió y el emparejamiento silenciosamente dejó de funcionar.
DO $$
DECLARE
  con_email   INT;
  vinculadas  INT;
  casables    INT;
BEGIN
  SELECT count(*) FILTER (WHERE invitee_email IS NOT NULL),
         count(*) FILTER (WHERE contact_id IS NOT NULL)
    INTO con_email, vinculadas
    FROM public.fathom_match_review;

  SELECT count(*) INTO casables
    FROM public.fathom_match_review f
   WHERE f.invitee_email IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.contacts c
        WHERE c.tenant_id = f.tenant_id
          AND c.email_normalized = lower(btrim(f.invitee_email))
          AND c.merged_into IS NULL
     );

  RAISE NOTICE 'fathom_match_review: % filas con correo, % casables por correo, % vinculadas',
    con_email, casables, vinculadas;

  IF casables > 0 AND vinculadas = 0 THEN
    RAISE EXCEPTION 'backfill de contact_id no vinculó ninguna fila habiendo % casables: revisar la normalización de correo', casables;
  END IF;
END $$;
