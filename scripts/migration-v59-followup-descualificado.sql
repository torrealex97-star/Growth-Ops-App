-- Añade la etapa "descualificado" al pipeline de seguimiento (migration-v58): leads que no se
-- vuelven a trabajar porque el lead no era válido (teléfono falso, datos inventados, etc), a
-- diferencia de "cerrado" (que implica venta/cierre real). El motivo se guarda en `notes` de la
-- agenda (columna ya existente, visible en la columna "Notas" del pipeline de seguimiento).
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_followup_stage_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_followup_stage_check
    CHECK (followup_stage IN ('pendiente_recontacto','en_seguimiento_pago','reagendado_pendiente','cerrado','descualificado'));
