-- ============================================================
-- OFERTA AUDITADA (spec §23: Show → Oferta → Venta con dato real)
-- ============================================================
-- La oferta YA se marca (MarcadoRapido → appointments.offered, reglas en
-- lib/agenda/marcado.ts) y el resolver del negocio (lib/metrics/oferta.ts)
-- distingue declarado / asumido / derivado. Lo que faltaba es la AUDITORÍA del
-- marcado: quién presentó la oferta y cuándo. Con esto:
--   · El funnel global (unit-economics) sabe si la etapa "Ofertas" está MEDIDA
--     o si es la suposición por defecto ("llamada celebrada = oferta").
--   · Cualquier corrección del Pitch Rate tiene dueño y fecha (§5/§36: toda
--     modificación manual queda auditada, nunca en silencio).
--
-- `offered` sigue siendo el dato (tri-estado: null = sin marcar). Estos dos
-- campos solo acompañan a los valores NO nulos; para null se limpian.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS offered_by UUID REFERENCES public.users(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ;

-- Backfill honesto: las filas ya marcadas no tienen autor conocido. `updated_at`
-- es la mejor aproximación disponible (el marcado es la última escritura que tocó
-- offered) y NO se inventa un autor: offered_by queda NULL = "marcado antes de
-- que existiera la auditoría".
UPDATE public.appointments
   SET offered_at = updated_at
 WHERE offered IS NOT NULL
   AND offered_at IS NULL;

COMMENT ON COLUMN public.appointments.offered_by IS 'Usuario que marcó la oferta como presentada. NULL = marcado antes de la auditoría o sin oferta.';
COMMENT ON COLUMN public.appointments.offered_at IS 'Momento del marcado de la oferta. NULL = sin marcar.';
