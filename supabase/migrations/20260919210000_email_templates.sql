-- ─────────────────────────────────────────────────────────────────────────────
-- PLANTILLAS DE EMAIL POR SUBCUENTA
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada subcuenta puede personalizar asunto y cuerpo de los correos transaccionales
-- (invitación, recovery, contratos, tareas, onboarding) sin tocar código. Si no hay
-- fila para (tenant_id, template_key), el envío usa la plantilla default del código
-- (lib/email/templates.ts) — el comportamiento de hoy, byte a byte.
--
-- Las plantillas guardadas usan variables {{empresa}}, {{nombre}}, {{enlace}}…
-- que el renderizador sustituye en el momento del envío.

CREATE TABLE IF NOT EXISTS public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,            -- clave del catálogo (invite, recovery, contract…)
  subject TEXT NOT NULL,                 -- asunto con variables {{…}}
  body_html TEXT NOT NULL,               -- cuerpo HTML con variables {{…}}
  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_key)
);

DROP TRIGGER IF EXISTS email_templates_updated_at ON public.email_templates;
CREATE TRIGGER email_templates_updated_at BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Estándar de la casa (20260919110000): dimensión de tenant SIEMPRE, roles de
-- plataforma exceptuados. La edición por rol (admin/director/manager) es lógica
-- de producto en la UI/API; RLS garantiza el aislamiento entre subcuentas.
DROP POLICY IF EXISTS email_templates_select ON public.email_templates;
CREATE POLICY email_templates_select ON public.email_templates FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS email_templates_insert ON public.email_templates;
CREATE POLICY email_templates_insert ON public.email_templates FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS email_templates_update ON public.email_templates;
CREATE POLICY email_templates_update ON public.email_templates FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS email_templates_delete ON public.email_templates;
CREATE POLICY email_templates_delete ON public.email_templates FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
