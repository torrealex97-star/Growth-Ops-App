-- ─────────────────────────────────────────────────────────────────────────────
-- MÓDULO DE EMAILS POR SUBCUENTA: settings de envío, historial y eventos
-- ─────────────────────────────────────────────────────────────────────────────
-- Responsabilidades (spec de gestión de emails):
--   · tenant_email_settings → identidad de envío del tenant (from/reply-to).
--     NO guarda credenciales: la API key de Resend vive SOLO en Integraciones
--     (tenant_config, cifrada) y la firma en company_profile (única fuente).
--   · email_messages → un registro por envío, con estado interno normalizado
--     (QUEUED/SENT/DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED/FAILED).
--   · email_events → timeline cruda del proveedor, idempotente por
--     (provider, provider_event_id): los reintentos del webhook no duplican.
--   · email_templates (de 20260919210000) → + name/description/enabled.
--
-- Sin seed de plantillas: el catálogo de lib/email/templates.ts actúa como
-- default universal para cualquier tenant (existente o nuevo) cuando no hay
-- fila — los defaults se actualizan con el deploy y no se duplican en BD.

-- ── 1. Identidad de envío por tenant ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_email_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_name TEXT,          -- "Acme Consulting"; NULL = nombre del perfil de empresa
  from_email TEXT,         -- "hola@acme.com"; NULL = RESEND_FROM de la integración
  reply_to_email TEXT,     -- "soporte@acme.com"; NULL = no enviar Reply-To
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_email_settings_from_email_format
    CHECK (from_email IS NULL OR from_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT tenant_email_settings_reply_to_format
    CHECK (reply_to_email IS NULL OR reply_to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

DROP TRIGGER IF EXISTS tenant_email_settings_updated_at ON public.tenant_email_settings;
CREATE TRIGGER tenant_email_settings_updated_at BEFORE UPDATE ON public.tenant_email_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── 2. Historial de envíos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,          -- id de Resend; lo usa el webhook para asociar
  template_key TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc_json JSONB,
  bcc_json JSONB,
  from_email TEXT NOT NULL,
  reply_to_email TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','SENT','DELIVERED','OPENED','CLICKED','BOUNCED','COMPLAINED','FAILED')),
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  related_entity_type TEXT,
  related_entity_id UUID,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_messages_tenant_created_idx
  ON public.email_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_tenant_status_idx
  ON public.email_messages (tenant_id, status);
CREATE INDEX IF NOT EXISTS email_messages_provider_msg_idx
  ON public.email_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS email_messages_updated_at ON public.email_messages;
CREATE TRIGGER email_messages_updated_at BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── 3. Timeline de eventos del proveedor (idempotente) ───────────────────────
CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email_message_id UUID NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_event_id TEXT NOT NULL,   -- svix-id del webhook (único por entrega del evento)
  event_type TEXT NOT NULL,          -- email.sent, email.delivered, … (namespaces de Resend)
  event_payload JSONB,
  event_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_events_idempotent UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS email_events_message_idx
  ON public.email_events (email_message_id, event_timestamp);

-- ── 4. email_templates: nombre, descripción y activación ─────────────────────
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 5. RLS (estándar de la casa: dimensión de tenant SIEMPRE) ────────────────
ALTER TABLE public.tenant_email_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tes_select ON public.tenant_email_settings;
CREATE POLICY tes_select ON public.tenant_email_settings FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
DROP POLICY IF EXISTS tes_insert ON public.tenant_email_settings;
CREATE POLICY tes_insert ON public.tenant_email_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
DROP POLICY IF EXISTS tes_update ON public.tenant_email_settings;
CREATE POLICY tes_update ON public.tenant_email_settings FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
DROP POLICY IF EXISTS tes_delete ON public.tenant_email_settings;
CREATE POLICY tes_delete ON public.tenant_email_settings FOR DELETE TO authenticated
  USING (is_super_admin());

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS em_select ON public.email_messages;
CREATE POLICY em_select ON public.email_messages FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
DROP POLICY IF EXISTS em_insert ON public.email_messages;
CREATE POLICY em_insert ON public.email_messages FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
DROP POLICY IF EXISTS em_update ON public.email_messages;
CREATE POLICY em_update ON public.email_messages FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ee_select ON public.email_events;
CREATE POLICY ee_select ON public.email_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());
DROP POLICY IF EXISTS ee_insert ON public.email_events;
CREATE POLICY ee_insert ON public.email_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

-- email_templates ya tiene sus policies tenant-scoped (20260919210000).
