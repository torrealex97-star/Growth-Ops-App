-- ═══════════════════════════════════════════════════════════════════════════
-- REMEDIACIÓN RLS: aislamiento cross-tenant + retirada de lectura anon
-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoría 2026-09-19 (pg_policies en producción: 303 policies, 96 tablas):
--
-- 1) FUGA CROSS-TENANT (grave). 38 policies cuyo predicado es solo
--    `get_my_role() IS NOT NULL` —sin dimensión de tenant— sobre tablas CON
--    tenant_id. `get_my_role()` devuelve el rol GLOBAL del usuario (no por
--    subcuenta), así que ese predicado = "cualquier usuario autenticado de
--    CUALQUIER subcuenta". 33 eran la ÚNICA policy de su (tabla, comando) y en
--    `collections` el OR con `collections_select_team` anulaba las policies
--    tenant-scoped existentes. Incluían stripe_payments, collections,
--    call_recordings, contact_notes… y 5 de ESCRITURA (INSERT/UPDATE) que
--    permitían inyectar filas con el tenant_id de otra subcuenta.
--
-- 2) LECTURA ANON DE TENANTS (media). `tenants_select_anon_by_slug` (creada en
--    20260911140000) promete "by_slug" pero su predicado es solo
--    `status='active'`: anon leía id/slug/name/settings de TODAS las
--    subcuentas. Único consumo legítimo: el branding del login, que ahora usa
--    la RPC `public_tenant_branding` (SECURITY DEFINER, devuelve SOLO
--    settings->'branding' del slug pedido).
--
-- ESTÁNDAR (regla de la casa a partir de ahora): toda policy sobre una tabla
-- con tenant_id lleva dimensión de tenant:
--    tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director()
-- `roles.roles_select` (USING true) queda documentado como aceptado: catálogo
-- global de 13 roles, sin PII ni datos de tenant.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. RPC pública de branding (sustituye la lectura anon de tenants) ──────
CREATE OR REPLACE FUNCTION public.public_tenant_branding(p_slug text)
RETURNS TABLE (branding jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.settings -> 'branding'
  FROM public.tenants t
  WHERE t.slug = p_slug
    AND t.status = 'active'
$$;

-- anon y authenticated pueden ejecutarla (es lo único público de tenants).
GRANT EXECUTE ON FUNCTION public.public_tenant_branding(text) TO anon, authenticated;

-- (Defensivo) retirar de anon todo privilegio directo sobre tenants; el acceso
-- autenticado ya lo gobierna RLS (tenants_select_member / tenants_modify_*).
REVOKE ALL ON public.tenants FROM anon;

DROP POLICY IF EXISTS tenants_select_anon_by_slug ON public.tenants;

-- ── 2. Policies solo-rol → con dimensión de tenant ─────────────────────────
-- Predicado estándar reutilizado en todos los CREATE:
--   (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
-- Se mantiene el nombre original de cada policy y se marca TO authenticated
-- (anon nunca pasaba get_my_role(); explícito por higiene).

-- collections: la solo-rol se ELIMINA sin recrear — sus 3 policies
-- tenant-scoped (tenant_isolation ALL, admin ALL, select_scope SELECT) cubren
-- el SELECT y dejaban de estar anuladas por el OR.
DROP POLICY IF EXISTS collections_select_team ON public.collections;

DROP POLICY IF EXISTS ac_select ON public.affiliate_campaigns;
CREATE POLICY ac_select ON public.affiliate_campaigns FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS aps_select ON public.affiliate_program_settings;
CREATE POLICY aps_select ON public.affiliate_program_settings FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS ai_business_facts_select_team ON public.ai_business_facts;
CREATE POLICY ai_business_facts_select_team ON public.ai_business_facts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS ai_business_facts_insert_team ON public.ai_business_facts;
CREATE POLICY ai_business_facts_insert_team ON public.ai_business_facts FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director()) AND created_by = auth.uid());

DROP POLICY IF EXISTS ai_insights_select_team ON public.ai_insights;
CREATE POLICY ai_insights_select_team ON public.ai_insights FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS ai_insights_update_status_team ON public.ai_insights;
CREATE POLICY ai_insights_update_status_team ON public.ai_insights FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director())
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS call_recordings_select_team ON public.call_recordings;
CREATE POLICY call_recordings_select_team ON public.call_recordings FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS campaign_daily_select ON public.campaign_daily;
CREATE POLICY campaign_daily_select ON public.campaign_daily FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS campaign_targets_select_team ON public.campaign_targets;
CREATE POLICY campaign_targets_select_team ON public.campaign_targets FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS collaborator_profiles_select ON public.collaborator_profiles;
CREATE POLICY collaborator_profiles_select ON public.collaborator_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS commission_rules_select ON public.commission_rules;
CREATE POLICY commission_rules_select ON public.commission_rules FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS contact_notes_select ON public.contact_notes;
CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS contact_notes_insert ON public.contact_notes;
CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS fathom_review_select_team ON public.fathom_match_review;
CREATE POLICY fathom_review_select_team ON public.fathom_match_review FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS ga4_daily_select_team ON public.ga4_daily;
CREATE POLICY ga4_daily_select_team ON public.ga4_daily FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS growth_context_read ON public.growth_context;
CREATE POLICY growth_context_read ON public.growth_context FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS integration_sync_runs_select ON public.integration_sync_runs;
CREATE POLICY integration_sync_runs_select ON public.integration_sync_runs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS kpi_templates_select ON public.kpi_form_templates;
CREATE POLICY kpi_templates_select ON public.kpi_form_templates FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS lt_select ON public.link_templates;
CREATE POLICY lt_select ON public.link_templates FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS manual_platform_records_select_team ON public.manual_platform_records;
CREATE POLICY manual_platform_records_select_team ON public.manual_platform_records FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS partners_select_team ON public.partners;
CREATE POLICY partners_select_team ON public.partners FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS payment_follow_ups_select ON public.payment_follow_ups;
CREATE POLICY payment_follow_ups_select ON public.payment_follow_ups FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS payment_follow_ups_insert ON public.payment_follow_ups;
CREATE POLICY payment_follow_ups_insert ON public.payment_follow_ups FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS payment_plans_select ON public.payment_plans;
CREATE POLICY payment_plans_select ON public.payment_plans FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS qq_select ON public.qualification_questions;
CREATE POLICY qq_select ON public.qualification_questions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS roleplays_select ON public.roleplays;
CREATE POLICY roleplays_select ON public.roleplays FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS installments_select_team ON public.sale_expected_installments;
CREATE POLICY installments_select_team ON public.sale_expected_installments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS installments_insert_team ON public.sale_expected_installments;
CREATE POLICY installments_insert_team ON public.sale_expected_installments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS sales_tramos_select ON public.sales_tramos;
CREATE POLICY sales_tramos_select ON public.sales_tramos FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS sales_tramos_config_select ON public.sales_tramos_config;
CREATE POLICY sales_tramos_config_select ON public.sales_tramos_config FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS views_shared ON public.saved_dashboard_views;
CREATE POLICY views_shared ON public.saved_dashboard_views FOR SELECT TO authenticated
  USING (scope = 'shared' AND (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director()));

DROP POLICY IF EXISTS stripe_customers_select_team ON public.stripe_customers;
CREATE POLICY stripe_customers_select_team ON public.stripe_customers FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS stripe_payments_select_team ON public.stripe_payments;
CREATE POLICY stripe_payments_select_team ON public.stripe_payments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS targets_select ON public.targets;
CREATE POLICY targets_select ON public.targets FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS tasks_select_team ON public.tasks;
CREATE POLICY tasks_select_team ON public.tasks FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS activities_insert ON public.activities;
CREATE POLICY activities_insert ON public.activities FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin() OR is_admin_or_director());

-- ── 3. Auto-verificación: la migración FALLA si queda alguna policy solo-rol
--    sin dimensión de tenant sobre una tabla con tenant_id (SELECT/escritura).
DO $$
DECLARE
  bad int;
  expr text;
BEGIN
  WITH tenant_tables AS (
    SELECT c.relname AS tn
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  )
  SELECT count(*)
  INTO bad
  FROM pg_policies p
  JOIN tenant_tables t ON t.tn = p.tablename
  WHERE p.schemaname = 'public'
    AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) LIKE '%get_my_role() is not null%'
    AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%tenant_id%'
    AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%auth_tenant_ids%'
    AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%is_super_admin%'
    AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%is_tenant_member%'
    AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%can_access%';

  IF bad > 0 THEN
    SELECT string_agg(p.tablename || '.' || p.policyname, ', ') INTO expr
    FROM pg_policies p
    WHERE lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) LIKE '%get_my_role() is not null%'
      AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%tenant_id%'
      AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%auth_tenant_ids%'
      AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%is_super_admin%'
      AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%is_tenant_member%'
      AND lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) NOT LIKE '%can_access%';
    RAISE EXCEPTION 'RLS: quedan % policies solo-rol sin dimensión de tenant: %', bad, expr;
  END IF;
END $$;
