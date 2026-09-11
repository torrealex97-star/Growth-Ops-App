-- Fase 2 of the Scalix Systems multi-tenant conversion: tenant_id on every
-- domain/reference table + a RESTRICTIVE tenant-isolation policy per table.
--
-- Design choice vs. the original plan sketch: instead of hand-rewriting each
-- table's existing PERMISSIVE policies (which encode real, table-specific
-- business logic — team/own scoping, role gates — documented across dozens
-- of migrations), we add ONE additional RESTRICTIVE policy per table.
-- Postgres ANDs restrictive policies with the result of permissive ones, so
-- this bolts on a hard tenant boundary without touching (or risking
-- corrupting) any existing policy. Same security semantics as the
-- USING (existing_condition AND tenant_condition) pattern the plan
-- described, applied uniformly instead of by hand per table.
--
-- Excluded: `roles` (shared platform catalog, intentionally global) and
-- `users` (identity table; tenant scope comes from tenant_members, not a
-- column on users). Idempotent — safe to re-run.

DO $$
DECLARE
  t TEXT;
  evergreen_id UUID;
BEGIN
  SELECT id INTO evergreen_id FROM public.tenants WHERE slug = 'evergreen';

  FOREACH t IN ARRAY ARRAY[
    'contacts','contact_attributions','appointments','products','payment_plans','sales',
    'sale_expected_installments','collections','refunds','commission_rules','commissions',
    'kpi_form_templates','kpi_daily_reports','targets','saved_dashboard_views','audit_logs',
    'content_items','tasks','campaigns','expenses','activities','csm_events','drops',
    'contact_notes','partners','contracts','qualification_questions','link_templates',
    'contract_templates','company_profile','affiliate_campaigns','affiliate_campaign_members',
    'affiliate_profiles','affiliate_program_settings','suggestions','ig_media','ig_account_daily',
    'ig_audience','ig_comments','ig_conversations_daily','fb_media','ig_competitors',
    'ig_competitor_media','app_settings','integration_settings','sales_tramos',
    'sales_tramos_config','campaign_ads','campaign_daily','commission_invoices','product_extras',
    'roleplays','reel_drafts','testimonios','deleted_appointments_log','document_verifications',
    'sequra_delinquent_customers','payment_follow_ups','youtube_uploads','positive_notes',
    'analytics_visitors','analytics_sessions','analytics_touchpoints','canonical_events',
    'identity_matches','delivery_attempts','vsl_videos','vsl_sessions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)', t);
    EXECUTE format('UPDATE public.%I SET tenant_id = $1 WHERE tenant_id IS NULL', t) USING evergreen_id;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(tenant_id)', t || '_tenant_idx', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin()) WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
