-- v18 — Programa de Afiliados
--   · Registro público con alta automática (formulario configurable por admin)
--   · Campañas de afiliados (enlaces por evento/lanzamiento/VSL) — SEPARADAS de la tabla `campaigns` de marketing
--   · Asignación (masiva) de afiliados a campañas
--   · Ajustes del programa: % de comisión por defecto + campos del formulario
--
-- Requiere helpers existentes: get_my_role(), is_admin_or_director(), handle_updated_at()

-- ------------------------------------------------------------
-- 1. CAMPAÑAS DE AFILIADOS (los enlaces que se comparten)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'otro',   -- evento / lanzamiento / vsl / otro
  base_url    TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS affiliate_campaigns_updated_at ON public.affiliate_campaigns;
CREATE TRIGGER affiliate_campaigns_updated_at BEFORE UPDATE ON public.affiliate_campaigns FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.affiliate_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ac_select ON public.affiliate_campaigns;
CREATE POLICY ac_select ON public.affiliate_campaigns FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS ac_modify ON public.affiliate_campaigns;
CREATE POLICY ac_modify ON public.affiliate_campaigns FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ------------------------------------------------------------
-- 2. ASIGNACIÓN AFILIADO ↔ CAMPAÑA (N:N)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_campaign_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.affiliate_campaigns(id) ON DELETE CASCADE,
  affiliate_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, affiliate_id)
);
CREATE INDEX IF NOT EXISTS acm_campaign_idx  ON public.affiliate_campaign_members(campaign_id);
CREATE INDEX IF NOT EXISTS acm_affiliate_idx ON public.affiliate_campaign_members(affiliate_id);
ALTER TABLE public.affiliate_campaign_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acm_select ON public.affiliate_campaign_members;
-- El afiliado puede ver sus propias asignaciones; liderazgo ve todas.
CREATE POLICY acm_select ON public.affiliate_campaign_members
  FOR SELECT USING (is_admin_or_director() OR affiliate_id = auth.uid());
DROP POLICY IF EXISTS acm_modify ON public.affiliate_campaign_members;
CREATE POLICY acm_modify ON public.affiliate_campaign_members FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ------------------------------------------------------------
-- 3. PERFIL DE AFILIADO (datos extra del formulario de registro)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  user_id       UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  instagram     TEXT,
  audience_size TEXT,
  niche         TEXT,
  source        TEXT,          -- "cómo nos conoció"
  motivation    TEXT,
  extra         JSONB,         -- respuestas de campos personalizados añadidos por el admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS affiliate_profiles_updated_at ON public.affiliate_profiles;
CREATE TRIGGER affiliate_profiles_updated_at BEFORE UPDATE ON public.affiliate_profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ap_select ON public.affiliate_profiles;
CREATE POLICY ap_select ON public.affiliate_profiles
  FOR SELECT USING (is_admin_or_director() OR user_id = auth.uid());
DROP POLICY IF EXISTS ap_modify ON public.affiliate_profiles;
CREATE POLICY ap_modify ON public.affiliate_profiles
  FOR ALL USING (is_admin_or_director() OR user_id = auth.uid())
  WITH CHECK (is_admin_or_director() OR user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. AJUSTES DEL PROGRAMA (singleton id=1)
--    default_commission_percent + configuración del formulario público
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_program_settings (
  id                          INT PRIMARY KEY DEFAULT 1,
  default_commission_percent  NUMERIC(5,2) NOT NULL DEFAULT 20,
  program_name                TEXT NOT NULL DEFAULT 'Programa de Afiliados',
  intro                       TEXT NOT NULL DEFAULT 'Únete a nuestro programa de afiliados. Rellena tus datos y te damos de alta al instante.',
  success_message             TEXT NOT NULL DEFAULT '¡Listo! Te hemos enviado un email para crear tu contraseña y acceder a tu panel.',
  form_fields                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{key,label,enabled,required}]
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT affiliate_program_settings_singleton CHECK (id = 1)
);
DROP TRIGGER IF EXISTS affiliate_program_settings_updated_at ON public.affiliate_program_settings;
CREATE TRIGGER affiliate_program_settings_updated_at BEFORE UPDATE ON public.affiliate_program_settings FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.affiliate_program_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aps_select ON public.affiliate_program_settings;
CREATE POLICY aps_select ON public.affiliate_program_settings FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS aps_modify ON public.affiliate_program_settings;
CREATE POLICY aps_modify ON public.affiliate_program_settings FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Fila por defecto con el set de campos inicial (el admin lo edita después).
INSERT INTO public.affiliate_program_settings (id, form_fields)
VALUES (
  1,
  '[
    {"key":"full_name","label":"Nombre completo","enabled":true,"required":true,"fixed":true},
    {"key":"email","label":"Email","enabled":true,"required":true,"fixed":true},
    {"key":"phone","label":"Teléfono (WhatsApp)","enabled":true,"required":true},
    {"key":"instagram","label":"Instagram / red principal","enabled":true,"required":true},
    {"key":"audience_size","label":"Tamaño de tu audiencia","enabled":true,"required":false},
    {"key":"niche","label":"Nicho / a qué te dedicas","enabled":true,"required":false},
    {"key":"source","label":"¿Cómo nos conociste?","enabled":true,"required":false}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
