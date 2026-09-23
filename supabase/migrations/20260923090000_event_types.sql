-- F1 — VOCABULARIO DE EVENTOS (`event_types`).
--
-- `canonical_events.event_name` es texto libre. Sin una lista declarada, cada sitio que escribe
-- inventa su nombre ("appointment_created", "cita_creada", "ghl.cita") y las métricas que filtran por
-- nombre se vuelven una lotería: un funnel deja de contar una etapa y nadie se entera, porque no hay
-- error — simplemente no coincide ninguna fila.
--
-- Esta tabla DECLARA los nombres válidos y qué significa cada uno. No los impone con una clave
-- foránea a propósito: un proveedor puede empezar a mandar algo nuevo mañana, y preferimos guardar
-- ese hecho con su nombre y descubrirlo aquí (queda como "no declarado") a rechazarlo y perderlo.
-- La tercera regla de AGENTS.md: el vocabulario lo elige el usuario, no el código.
--
-- Se siembra desde `lib/eventos/canonico.ts` (TIPOS_DE_EVENTO) para que no haya dos listas que se
-- separen: la del código manda, y esta migración es su espejo.

CREATE TABLE IF NOT EXISTS public.event_types (
  -- El nombre ES la clave: es lo que se escribe en canonical_events.event_name y por lo que filtran
  -- las métricas. Un id numérico aparte solo añadiría un salto para llegar al mismo sitio.
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  -- De dónde sale este tipo de hecho. NULL = lo produce la app, no una integración.
  source TEXT,
  -- Un tipo retirado no se borra: se marca. Borrarlo dejaría huérfanos los hechos históricos que
  -- todavía lo usan, y esos hechos son inmutables.
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El vocabulario es de la PLATAFORMA, no de cada subcuenta: "una cita de GHL" significa lo mismo
-- para todos los clientes. Por eso no lleva tenant_id — y por eso se lee sin restricción pero solo
-- el rol de servicio puede escribirlo.
ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_types_lectura ON public.event_types;
CREATE POLICY event_types_lectura ON public.event_types FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.event_types IS
  'Vocabulario de canonical_events.event_name. Se siembra desde lib/eventos/canonico.ts (TIPOS_DE_EVENTO).';

INSERT INTO public.event_types (name, description, source) VALUES
  ('ghl.cita.registrada',      'GHL comunica una cita nueva o actualizada.',                        'ghl'),
  ('ghl.cita.cancelada',       'GHL comunica que una cita se canceló.',                             'ghl'),
  ('ghl.cita.reprogramada',    'GHL comunica que una cita cambió de fecha.',                        'ghl'),
  ('ghl.contacto.actualizado', 'GHL comunica un alta o un cambio de contacto.',                     'ghl'),
  ('ghl.evento.recibido',      'Evento de GHL recibido y guardado, sin clasificar todavía.',        'ghl')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;
