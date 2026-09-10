-- v42 — Testimonios / casos de éxito: repositorio único de los casos de alumnos y
-- clientes, con foto, enlace al vídeo de YouTube y la estructura punto A → punto B →
-- vehículo. Lo usan (a) los closers para tener el testimonio a mano en llamada y
-- (b) el generador de guiones para añadir prueba social al contenido.
-- Requiere helpers existentes: get_my_role().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.testimonios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,               -- identificador estable (xavi, maxi, mariapaz…)
  name TEXT NOT NULL,                      -- nombre para mostrar
  kind TEXT NOT NULL DEFAULT 'alumno' CHECK (kind IN ('alumno', 'cliente')),
  avatar TEXT,                             -- avatar al que representa (quemado, agencia, empresario…)
  sector TEXT,                              -- nicho / sector (inmobiliaria, salud, hostelería…)
  photo_url TEXT,
  youtube_url TEXT,                        -- vídeo del testimonio en el canal
  hook TEXT,                               -- frase gancho
  punto_a TEXT,                            -- de dónde venía y qué le dolía
  punto_b TEXT,                            -- dónde está ahora
  vehiculo TEXT,                           -- qué usó exactamente para conseguirlo
  cifra TEXT,                              -- cifra ancla en texto ("23.000€ en 30 días")
  -- false = testimonio de proceso (sin facturación aún). El generador de guiones NO
  -- puede atribuirle cifras económicas.
  has_revenue BOOLEAN NOT NULL DEFAULT true,
  consent BOOLEAN NOT NULL DEFAULT false,  -- consentimiento de imagen/nombre verificado
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS testimonios_active_idx ON public.testimonios (active, sort_order);
CREATE INDEX IF NOT EXISTS testimonios_avatar_idx ON public.testimonios (avatar);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura amplia: los closers y setters los necesitan en llamada. Las escrituras van
-- por endpoints con service-role (saltan RLS), así que no hay política de escritura.
ALTER TABLE public.testimonios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS testimonios_select ON public.testimonios;
CREATE POLICY testimonios_select ON public.testimonios FOR SELECT
  USING (get_my_role() IN ('admin', 'director', 'manager', 'marketing', 'editor', 'setter', 'closer', 'triager', 'cold_caller', 'csm'));
