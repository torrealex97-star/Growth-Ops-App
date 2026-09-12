-- Fase 2 del agente de IA: memoria de negocio explícita + motor de insights proactivo
-- determinista. Ninguna de las dos tablas guarda "lo que dijo el LLM" a ciegas — los hechos de
-- ai_business_facts solo se escriben cuando el usuario los confirma explícitamente (regla en el
-- system prompt del agente, no en la BD), y los insights de ai_insights se generan por un
-- detector determinista (comparación de periodos con umbrales), no por un LLM corriendo en bucle.

-- Memoria de negocio: hechos explícitos, hipótesis, decisiones y sus resultados posteriores.
-- outcome_of enlaza un resultado con la decisión que lo causó (DECISION → OUTCOME).
CREATE TABLE public.ai_business_facts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  type          TEXT NOT NULL CHECK (type IN ('business', 'hypothesis', 'decision', 'outcome')),
  content       TEXT NOT NULL,
  evidence      JSONB,
  outcome_of    UUID REFERENCES public.ai_business_facts(id) ON DELETE SET NULL,
  created_by    UUID NOT NULL REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_business_facts_tenant_idx ON public.ai_business_facts(tenant_id, type, created_at DESC);

ALTER TABLE public.ai_business_facts ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro del equipo puede registrar un hecho confirmado (el agente lo hace en su
-- nombre, con su propia sesión) y leer los de su tenant; solo admin/director puede corregir/borrar.
CREATE POLICY "ai_business_facts_select_team" ON public.ai_business_facts FOR SELECT
  USING (get_my_role() IS NOT NULL);
CREATE POLICY "ai_business_facts_insert_team" ON public.ai_business_facts FOR INSERT
  WITH CHECK (get_my_role() IS NOT NULL AND created_by = auth.uid());
CREATE POLICY "ai_business_facts_modify_admin" ON public.ai_business_facts FOR UPDATE
  USING (is_admin_or_director());
CREATE POLICY "ai_business_facts_delete_admin" ON public.ai_business_facts FOR DELETE
  USING (is_admin_or_director());

CREATE POLICY "ai_business_facts_tenant_isolation" ON public.ai_business_facts AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

-- Insights proactivos: solo los escribe el detector determinista (cron, service role) —
-- ver app/api/[tenant]/evergreen/cron/ai-insights/route.ts. El fingerprint (tipo+métrica+semana)
-- deduplica: no se repite el mismo aviso cada vez que corre el cron mientras siga vigente.
CREATE TABLE public.ai_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  type          TEXT NOT NULL, -- p.ej. 'cac_increase', 'show_rate_drop', 'roas_decrease'
  severity      TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'opportunity', 'info')),
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'acknowledged', 'resolved', 'stale')),
  fingerprint   TEXT NOT NULL,
  period_start  DATE,
  period_end    DATE,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, fingerprint)
);

CREATE INDEX ai_insights_tenant_status_idx ON public.ai_insights(tenant_id, status, generated_at DESC);

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_insights_select_team" ON public.ai_insights FOR SELECT USING (get_my_role() IS NOT NULL);
-- El equipo puede marcar un insight como visto/reconocido/resuelto, pero no crear ni borrar
-- (eso es del detector determinista, vía service role, que bypassa RLS).
CREATE POLICY "ai_insights_update_status_team" ON public.ai_insights FOR UPDATE USING (get_my_role() IS NOT NULL);

CREATE POLICY "ai_insights_tenant_isolation" ON public.ai_insights AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
