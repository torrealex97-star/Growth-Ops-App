-- v14 — Calendly avanzado + Enlaces
-- Auto-descubrimiento de preguntas de formulario
CREATE TABLE IF NOT EXISTS public.qualification_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  question_text TEXT,
  field_key TEXT,               -- si mapea a un campo (p.ej. 'edad'→contacts.age)
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.qualification_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qq_select ON public.qualification_questions;
CREATE POLICY qq_select ON public.qualification_questions FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS qq_all ON public.qualification_questions;
CREATE POLICY qq_all ON public.qualification_questions FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Código de tracking por usuario (utm_term para setters/cold_callers, utm_content para afiliados)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tracking_code TEXT;

-- Datos de Calendly en la agenda
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reschedule_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendly_event_uuid TEXT;

-- Plantillas de enlace (Agenda, VSL, etc.)
CREATE TABLE IF NOT EXISTS public.link_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  applies_to TEXT[] NOT NULL DEFAULT ARRAY['setter','cold_caller','affiliate'],  -- roles a los que genera enlace
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS link_templates_updated_at ON public.link_templates;
CREATE TRIGGER link_templates_updated_at BEFORE UPDATE ON public.link_templates FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.link_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lt_select ON public.link_templates;
CREATE POLICY lt_select ON public.link_templates FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS lt_modify ON public.link_templates;
CREATE POLICY lt_modify ON public.link_templates FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());
