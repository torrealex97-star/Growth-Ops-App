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
-- NOTA: estas 3 tablas (carrusel_projects, carrusel_templates, carrusel_brand) no tienen ninguna
-- migración de CREATE TABLE en este repositorio — se crearon en algún momento directamente desde
-- el dashboard de Supabase, sin pasar por migración versionada (una infracción previa a esta
-- sesión, no introducida aquí). Esta migración asume que las tablas YA EXISTEN en el proyecto real
-- (así debe ser, dado que la app las usa en producción) y usa ADD COLUMN IF NOT EXISTS /
-- CREATE POLICY idempotente para no fallar si se reaplica. Si en algún entorno estas tablas no
-- existen todavía, esta migración fallará ahí — créalas primero con el mismo shape que usa
-- lib/carruseles/store.ts antes de aplicar esta migración en ese entorno.
--
-- carrusel_brand es un singleton (id=1) compartido hoy entre TODO el sistema — con esta migración
-- pasa a ser un singleton POR TENANT (tenant_id, con id todavía autogenerado), y el código
-- (store.ts) se actualiza para leerlo/escribirlo por tenant_id en vez de por id=1 fijo.

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
  DROP POLICY IF EXISTS carrusel_brand_tenant_isolation ON public.carrusel_brand;
  CREATE POLICY carrusel_brand_tenant_isolation ON public.carrusel_brand AS RESTRICTIVE FOR ALL
    USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
    WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
END $$;
