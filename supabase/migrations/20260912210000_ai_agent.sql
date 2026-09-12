-- Agente de IA empresarial (chat flotante) — MVP: conversaciones + mensajes + log de auditoría
-- de herramientas. El agente nunca recibe una conexión SQL libre: cada "tool" es una función
-- server-side ya acotada por tenant_id (resuelto en servidor vía requireTenant, nunca desde el
-- prompt), que consulta tablas ya existentes (contacts, sales, campaigns, appointments...).
-- Esta migración solo añade el estado de la conversación y la auditoría, no una capa de datos
-- paralela: los "hechos" que el agente cita siguen viviendo en las tablas canónicas de siempre.

CREATE TABLE public.ai_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  user_id       UUID NOT NULL REFERENCES public.users(id),
  title         TEXT,
  screen        TEXT, -- pantalla desde la que se abrió (UI_CONTEXT), para sugerencias/contexto
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX ai_conversations_tenant_user_idx ON public.ai_conversations(tenant_id, user_id, updated_at DESC);

CREATE TABLE public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  -- Evidencia estructurada (qué tools/fuentes respaldan la respuesta) para pintar citas en la UI.
  -- Null en mensajes de usuario.
  evidence        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_messages_conversation_idx ON public.ai_messages(conversation_id, created_at);

-- Auditoría de cada tool ejecutada por el agente (qué se consultó, no el contenido devuelto
-- completo) — permite reconstruir QUESTION → TOOLS → ANSWER para depuración/seguridad sin
-- guardar datos sensibles de más.
CREATE TABLE public.ai_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES public.ai_messages(id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  input           JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary  TEXT, -- resumen corto ("14 campañas, 2026-08-01..2026-09-11"), no el payload completo
  success         BOOLEAN NOT NULL DEFAULT TRUE,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_tool_calls_conversation_idx ON public.ai_tool_calls(conversation_id, created_at);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_calls ENABLE ROW LEVEL SECURITY;

-- Las conversaciones son privadas del usuario que las inició (no un chat de equipo compartido).
-- El API route usa el cliente autenticado del usuario (no service role) para leer/escribir su
-- propio historial, así que estas políticas SÍ se ejercen en el camino normal, no son decorativas.
CREATE POLICY "ai_conversations_own" ON public.ai_conversations FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_messages_own" ON public.ai_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

-- El log de auditoría lo escribe el propio API route con el cliente autenticado del usuario (no
-- service role) — igual que los mensajes, solo el dueño de la conversación puede insertar/leer.
CREATE POLICY "ai_tool_calls_own" ON public.ai_tool_calls FOR ALL
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

-- Aislamiento multi-tenant (mismo patrón que el resto de tablas de negocio): además de ser
-- "propias del usuario", nunca pueden cruzar de tenant aunque el filtro de arriba fallara.
CREATE POLICY "ai_conversations_tenant_isolation" ON public.ai_conversations AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

CREATE POLICY "ai_messages_tenant_isolation" ON public.ai_messages AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

CREATE POLICY "ai_tool_calls_tenant_isolation" ON public.ai_tool_calls AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
