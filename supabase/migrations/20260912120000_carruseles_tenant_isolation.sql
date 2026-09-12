-- FIX DE SEGURIDAD P0 — IDOR cross-tenant real en el módulo de Carruseles.
--
-- lib/carruseles/store.ts usa el cliente service-role (bypassa RLS) y NINGUNA de sus funciones
-- filtraba por tenant_id — de hecho estas 3 tablas nunca tuvieron esa columna: no aparecen en el
-- array de `20260911150000_multi_tenant_domain_tables.sql` que añadió tenant_id + RLS RESTRICTIVE
-- a todas las demás tablas de dominio durante la conversión multi-tenant. Un usuario autenticado
-- de "women-digital-closer" podía leer/editar/eliminar/duplicar cualquier proyecto o plantilla de
-- carrusel de "evergreen" (o viceversa) solo cambiando el id en la URL — y ni siquiera hacía falta
-- adivinarlo: el propio listado (GET /carruseles) devolvía los proyectos de TODOS los tenants
-- mezclados sin ningún filtro.
--
-- La inspección no destructiva de producción del 12/09/2026 confirmó que las tres tablas todavía
-- no existen (PostgREST PGRST205). Por eso esta migración crea primero el shape exacto que consume
-- lib/carruseles/store.ts. Los CREATE/ALTER posteriores siguen siendo idempotentes para entornos
-- donde las tablas ya existan.
--
-- carrusel_brand es un singleton (id=1) compartido hoy entre TODO el sistema — con esta migración
-- pasa a ser un singleton POR TENANT (tenant_id, con id todavía autogenerado), y el código
-- (store.ts) se actualiza para leerlo/escribirlo por tenant_id en vez de por id=1 fijo.

CREATE TABLE IF NOT EXISTS public.carrusel_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'carousel' CHECK (kind IN ('carousel', 'flyer')),
  aspect_ratio TEXT NOT NULL DEFAULT '4:5' CHECK (aspect_ratio IN ('1:1', '4:5', '9:16', '3:4', 'A4')),
  slides JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(slides) = 'array'),
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reference_images) = 'array'),
  caption TEXT,
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(hashtags) = 'array'),
  is_template BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carrusel_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'carousel' CHECK (kind IN ('carousel', 'flyer')),
  aspect_ratio TEXT NOT NULL DEFAULT '4:5' CHECK (aspect_ratio IN ('1:1', '4:5', '9:16', '3:4', 'A4')),
  slides JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(slides) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carrusel_brand (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  colors JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(colors) = 'object'),
  fonts JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fonts) = 'object'),
  logo_url TEXT,
  style_keywords JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(style_keywords) = 'array'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los GRANT y las políticas RLS son capas complementarias. No concedemos acceso a anon;
-- service_role se mantiene para los endpoints de servidor y authenticated queda limitado
-- por las políticas tenant-scoped definidas más abajo.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrusel_projects TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrusel_templates TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrusel_brand TO authenticated, service_role;

DO $$
DECLARE
  evergreen_id UUID;
BEGIN
  SELECT id INTO evergreen_id FROM public.tenants WHERE slug = 'evergreen';

  -- carrusel_projects
  ALTER TABLE public.carrusel_projects ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
  UPDATE public.carrusel_projects SET tenant_id = evergreen_id WHERE tenant_id IS NULL;
  ALTER TABLE public.carrusel_projects ALTER COLUMN tenant_id SET NOT NULL;
  CREATE INDEX IF NOT EXISTS carrusel_projects_tenant_idx ON public.carrusel_projects(tenant_id);
  ALTER TABLE public.carrusel_projects ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS carrusel_projects_authenticated ON public.carrusel_projects;
  CREATE POLICY carrusel_projects_authenticated ON public.carrusel_projects AS PERMISSIVE FOR ALL
    TO authenticated
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
  DROP POLICY IF EXISTS carrusel_projects_tenant_isolation ON public.carrusel_projects;
  CREATE POLICY carrusel_projects_tenant_isolation ON public.carrusel_projects AS RESTRICTIVE FOR ALL
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

  -- carrusel_templates
  ALTER TABLE public.carrusel_templates ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
  UPDATE public.carrusel_templates SET tenant_id = evergreen_id WHERE tenant_id IS NULL;
  ALTER TABLE public.carrusel_templates ALTER COLUMN tenant_id SET NOT NULL;
  CREATE INDEX IF NOT EXISTS carrusel_templates_tenant_idx ON public.carrusel_templates(tenant_id);
  ALTER TABLE public.carrusel_templates ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS carrusel_templates_authenticated ON public.carrusel_templates;
  CREATE POLICY carrusel_templates_authenticated ON public.carrusel_templates AS PERMISSIVE FOR ALL
    TO authenticated
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
  DROP POLICY IF EXISTS carrusel_templates_tenant_isolation ON public.carrusel_templates;
  CREATE POLICY carrusel_templates_tenant_isolation ON public.carrusel_templates AS RESTRICTIVE FOR ALL
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

  -- carrusel_brand: singleton por tenant en vez de singleton global (id=1 compartido).
  ALTER TABLE public.carrusel_brand ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
  UPDATE public.carrusel_brand SET tenant_id = evergreen_id WHERE tenant_id IS NULL;
  ALTER TABLE public.carrusel_brand ALTER COLUMN tenant_id SET NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS carrusel_brand_tenant_unique_idx ON public.carrusel_brand(tenant_id);
  ALTER TABLE public.carrusel_brand ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS carrusel_brand_authenticated ON public.carrusel_brand;
  CREATE POLICY carrusel_brand_authenticated ON public.carrusel_brand AS PERMISSIVE FOR ALL
    TO authenticated
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
  DROP POLICY IF EXISTS carrusel_brand_tenant_isolation ON public.carrusel_brand;
  CREATE POLICY carrusel_brand_tenant_isolation ON public.carrusel_brand AS RESTRICTIVE FOR ALL
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
END $$;
