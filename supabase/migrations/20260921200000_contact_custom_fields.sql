-- CAMPOS PERSONALIZADOS DE CONTACTOS (§1 del brief de contactos).
--
-- Cada subcuenta define sus propios campos (texto, número, fecha, boolean) y cada contacto
-- guarda sus respuestas en `contacts.custom_fields` (jsonb: { "<field_id>": valor }).
-- Modelo tipo GHL/Salesforce en versión mínima:
--   · Definición por subcuenta en `custom_field_defs` (nombre, tipo, orden, clave única).
--   · Valores POR CONTACTO en jsonb — sin columnas nuevas por campo ni migración por campo.
--   · Borrar una definición limpia también su valor en los contactos (cleanup jsonb).

CREATE TABLE IF NOT EXISTS public.custom_field_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'boolean')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_defs_tenant ON public.custom_field_defs (tenant_id);

-- Estándar de la casa (20260919110000): dimensión de tenant SIEMPRE. La edición por rol es
-- lógica de producto en la UI/API; RLS garantiza el aislamiento entre subcuentas.
ALTER TABLE public.custom_field_defs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_field_defs_select ON public.custom_field_defs;
CREATE POLICY custom_field_defs_select ON public.custom_field_defs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin());

DROP POLICY IF EXISTS custom_field_defs_insert ON public.custom_field_defs;
CREATE POLICY custom_field_defs_insert ON public.custom_field_defs FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin());

DROP POLICY IF EXISTS custom_field_defs_update ON public.custom_field_defs;
CREATE POLICY custom_field_defs_update ON public.custom_field_defs FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin())
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin());

DROP POLICY IF EXISTS custom_field_defs_delete ON public.custom_field_defs;
CREATE POLICY custom_field_defs_delete ON public.custom_field_defs FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin());

-- Los valores viven en un jsonb del contacto: sin ALTER TABLE por campo nuevo.
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Borrar una definición elimina también su valor de todos los contactos de la subcuenta.
CREATE OR REPLACE FUNCTION public.cleanup_custom_field_values()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.contacts
  SET custom_fields = custom_fields - OLD.id::text
  WHERE tenant_id = OLD.tenant_id AND custom_fields ? OLD.id::text;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_custom_field_values ON public.custom_field_defs;
CREATE TRIGGER trg_cleanup_custom_field_values
  AFTER DELETE ON public.custom_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_custom_field_values();
