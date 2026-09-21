-- F6 — `contacts.lifecycle`: en qué punto del ciclo está una persona, incluido "borrada".
--
-- POR QUÉ AQUÍ Y NO EN F7. El plan describe `lifecycle` en identidad (`01-arquitectura-datos.md`
-- §3, F7), pero `erase_person` —que es F6— necesita marcar a la persona como borrada, y la
-- Enmienda 1 de la constitución adelantó F6 por delante. La columna nace aquí con el enum completo
-- para que F7 la encuentre lista y no haya que migrarla dos veces.
--
-- POR QUÉ UN ESTADO Y NO UN BORRADO FÍSICO. Borrar la fila entera arrastraría las claves foráneas de
-- hechos que deben sobrevivir (ventas, cobros, facturas con obligación legal). El contacto se
-- conserva como cáscara sin PII, con `lifecycle = 'erased'`, para que los agregados sigan cuadrando
-- y nadie pueda reconstruir a la persona. Ver `docs/F6-MAPA-PII.md`.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'identified';

-- Se añade aparte de la columna para que re-ejecutar la migración no falle si ya existía.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lifecycle_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_lifecycle_check
      CHECK (lifecycle IN ('handle_only', 'identified', 'customer', 'erased'));
  END IF;
END $$;

COMMENT ON COLUMN public.contacts.lifecycle IS
  'handle_only: solo identificador social, sin correo ni teléfono (funnel A). identified: con dato '
  'de contacto. customer: ha comprado. erased: PII borrada por erase_person; la fila se conserva '
  'sin datos personales para no romper hechos con obligación legal.';

-- Las consultas de negocio deben poder excluir a las personas borradas sin un seq scan.
CREATE INDEX IF NOT EXISTS contacts_tenant_lifecycle_idx
  ON public.contacts (tenant_id, lifecycle);
