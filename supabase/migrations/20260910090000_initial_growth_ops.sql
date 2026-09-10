-- ============================================================
-- GROWTH OPS — INITIAL SCHEMA
-- Migración no destructiva para el proyecto nuevo.
-- ============================================================

-- ============================================================
-- 1. HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT r.key FROM public.roles r
    JOIN public.users u ON u.role_id = r.id
    WHERE u.id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin_or_director()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_my_role() IN ('admin', 'director');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 2. ROLES
-- ============================================================
CREATE TABLE public.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_select" ON public.roles FOR SELECT USING (TRUE);
CREATE POLICY "roles_modify" ON public.roles FOR ALL USING (is_admin_or_director());

-- ============================================================
-- 3. USERS (linked to auth.users)
-- ============================================================
CREATE TABLE public.users (
  id                                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name                             TEXT NOT NULL,
  email                                 TEXT NOT NULL,
  phone                                 TEXT,
  role_id                               UUID NOT NULL REFERENCES public.roles(id),
  is_active                             BOOLEAN NOT NULL DEFAULT TRUE,
  default_affiliate_commission_percent  NUMERIC(5,2),
  avatar_url                            TEXT,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select"       ON public.users FOR SELECT USING (is_admin_or_director() OR id = auth.uid());
CREATE POLICY "users_insert_admin" ON public.users FOR INSERT WITH CHECK (is_admin_or_director());
CREATE POLICY "users_update_self"  ON public.users FOR UPDATE USING (id = auth.uid() OR is_admin_or_director());
CREATE POLICY "users_delete_admin" ON public.users FOR DELETE USING (is_admin_or_director());

-- ============================================================
-- 4. CONTACTS
-- ============================================================
CREATE TABLE public.contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name   TEXT,
  last_name    TEXT,
  full_name    TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  country      TEXT,
  company_name TEXT,
  notes        TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_all" ON public.contacts FOR ALL USING (is_admin_or_director());
CREATE POLICY "contacts_select_team" ON public.contacts FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- 5. CONTACT ATTRIBUTIONS
-- ============================================================
CREATE TABLE public.contact_attributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source        TEXT,
  funnel        TEXT,
  landing_url   TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  first_touch_at TIMESTAMPTZ,
  last_touch_at  TIMESTAMPTZ,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER contact_attributions_updated_at
  BEFORE UPDATE ON public.contact_attributions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.contact_attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contact_attributions_all" ON public.contact_attributions FOR ALL USING (is_admin_or_director());
CREATE POLICY "contact_attributions_select_team" ON public.contact_attributions FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- 6. APPOINTMENTS
-- ============================================================
CREATE TABLE public.appointments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source      TEXT NOT NULL DEFAULT 'manual',
  external_id          TEXT,
  contact_id           UUID NOT NULL REFERENCES public.contacts(id),
  appointment_datetime TIMESTAMPTZ NOT NULL,
  status               TEXT NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','confirmed','show','no_show','cancelled','rescheduled')),
  setter_id            UUID REFERENCES public.users(id),
  closer_id            UUID REFERENCES public.users(id),
  source               TEXT,
  pipeline_name        TEXT,
  pipeline_stage       TEXT,
  calendar_name        TEXT,
  utm_source           TEXT,
  utm_medium           TEXT,
  utm_campaign         TEXT,
  utm_content          TEXT,
  utm_term             TEXT,
  raw_payload          JSONB,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appointments_all"         ON public.appointments FOR ALL   USING (is_admin_or_director());
CREATE POLICY "appointments_select_team" ON public.appointments FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- 7. PRODUCTS & PAYMENT PLANS
-- ============================================================
CREATE TABLE public.products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select" ON public.products FOR SELECT USING (get_my_role() IS NOT NULL);
CREATE POLICY "products_modify" ON public.products FOR ALL   USING (is_admin_or_director());

CREATE TABLE public.payment_plans (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  code                    TEXT,
  gross_price             NUMERIC(12,2) NOT NULL,
  number_of_payments      INT NOT NULL DEFAULT 1,
  financing_provider      TEXT,
  cash_collection_ratio   NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order              INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER payment_plans_updated_at
  BEFORE UPDATE ON public.payment_plans
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_plans_select" ON public.payment_plans FOR SELECT USING (get_my_role() IS NOT NULL);
CREATE POLICY "payment_plans_modify" ON public.payment_plans FOR ALL   USING (is_admin_or_director());

-- ============================================================
-- 8. SALES
-- ============================================================
CREATE TABLE public.sales (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id                     UUID NOT NULL REFERENCES public.contacts(id),
  appointment_id                 UUID REFERENCES public.appointments(id),
  product_id                     UUID NOT NULL REFERENCES public.products(id),
  payment_plan_id                UUID NOT NULL REFERENCES public.payment_plans(id),
  sale_date                      DATE NOT NULL,
  refund_deadline_at             DATE NOT NULL,
  gross_amount                   NUMERIC(12,2) NOT NULL,
  expected_commissionable_amount NUMERIC(12,2),
  setter_id                      UUID REFERENCES public.users(id),
  closer_id                      UUID REFERENCES public.users(id),
  affiliate_id                   UUID REFERENCES public.users(id),
  affiliate_commission_percent   NUMERIC(5,2),
  status                         TEXT NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','refunded','partial_refund','chargeback','cancelled')),
  created_by                     UUID NOT NULL REFERENCES public.users(id),
  updated_by                     UUID REFERENCES public.users(id),
  notes                          TEXT,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER sales_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_all"         ON public.sales FOR ALL   USING (is_admin_or_director());
CREATE POLICY "sales_select_team" ON public.sales FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- 9. SALE EXPECTED INSTALLMENTS
-- ============================================================
CREATE TABLE public.sale_expected_installments (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id                      UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  installment_number           INT NOT NULL,
  due_date                     DATE,
  expected_gross_amount        NUMERIC(12,2) NOT NULL,
  expected_commissionable_amount NUMERIC(12,2) NOT NULL,
  status                       TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','collected','overdue','cancelled')),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER sale_expected_installments_updated_at
  BEFORE UPDATE ON public.sale_expected_installments
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.sale_expected_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installments_all"         ON public.sale_expected_installments FOR ALL   USING (is_admin_or_director());
CREATE POLICY "installments_select_team" ON public.sale_expected_installments FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- 10. COLLECTIONS
-- ============================================================
CREATE TABLE public.collections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id                 UUID NOT NULL REFERENCES public.sales(id),
  expected_installment_id UUID REFERENCES public.sale_expected_installments(id),
  collected_at            TIMESTAMPTZ NOT NULL,
  gross_amount            NUMERIC(12,2) NOT NULL,
  commissionable_amount   NUMERIC(12,2) NOT NULL,
  payment_method          TEXT,
  payment_provider        TEXT,
  payment_reference       TEXT,
  is_confirmed            BOOLEAN NOT NULL DEFAULT FALSE,
  is_eligible_for_commission BOOLEAN NOT NULL DEFAULT FALSE,
  eligible_at             TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'collected'
                            CHECK (status IN ('collected','reversed','disputed')),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER collections_updated_at
  BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collections_all"         ON public.collections FOR ALL   USING (is_admin_or_director());
CREATE POLICY "collections_select_team" ON public.collections FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- 11. REFUNDS
-- ============================================================
CREATE TABLE public.refunds (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id                      UUID NOT NULL REFERENCES public.sales(id),
  collection_id                UUID REFERENCES public.collections(id),
  refund_date                  DATE NOT NULL,
  gross_refund_amount          NUMERIC(12,2) NOT NULL,
  commissionable_refund_amount NUMERIC(12,2) NOT NULL,
  reason                       TEXT,
  status                       TEXT NOT NULL DEFAULT 'processed'
                                 CHECK (status IN ('processed','pending','rejected')),
  created_by                   UUID NOT NULL REFERENCES public.users(id),
  notes                        TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER refunds_updated_at
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refunds_all" ON public.refunds FOR ALL USING (is_admin_or_director());

-- ============================================================
-- 12. COMMISSION RULES
-- ============================================================
CREATE TABLE public.commission_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_type TEXT NOT NULL CHECK (participant_type IN ('setter','closer','affiliate')),
  percent          NUMERIC(5,2) NOT NULL,
  active_from      DATE NOT NULL,
  active_to        DATE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER commission_rules_updated_at
  BEFORE UPDATE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_rules_select" ON public.commission_rules FOR SELECT USING (get_my_role() IS NOT NULL);
CREATE POLICY "commission_rules_modify" ON public.commission_rules FOR ALL   USING (is_admin_or_director());

-- ============================================================
-- 13. COMMISSIONS
-- ============================================================
CREATE TABLE public.commissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           UUID NOT NULL REFERENCES public.sales(id),
  collection_id     UUID REFERENCES public.collections(id),
  refund_id         UUID REFERENCES public.refunds(id),
  user_id           UUID NOT NULL REFERENCES public.users(id),
  participant_type  TEXT NOT NULL CHECK (participant_type IN ('setter','closer','affiliate')),
  percent           NUMERIC(5,2) NOT NULL,
  base_amount       NUMERIC(12,2) NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL,
  direction         TEXT NOT NULL DEFAULT 'positive' CHECK (direction IN ('positive','negative')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','liquidated','cancelled')),
  liquidation_month TEXT NOT NULL,
  approved_by       UUID REFERENCES public.users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER commissions_updated_at
  BEFORE UPDATE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commissions_admin"       ON public.commissions FOR ALL    USING (is_admin_or_director());
CREATE POLICY "commissions_select_self" ON public.commissions FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- 14. KPI FORM TEMPLATES
-- ============================================================
CREATE TABLE public.kpi_form_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key       TEXT NOT NULL,
  field_key      TEXT NOT NULL,
  field_label    TEXT NOT NULL,
  field_type     TEXT NOT NULL DEFAULT 'number'
                   CHECK (field_type IN ('number','text','textarea','boolean','select','date')),
  placeholder    TEXT,
  help_text      TEXT,
  is_required    BOOLEAN NOT NULL DEFAULT TRUE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0,
  select_options JSONB,
  default_value  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_key, field_key)
);

CREATE TRIGGER kpi_form_templates_updated_at
  BEFORE UPDATE ON public.kpi_form_templates
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.kpi_form_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_templates_select" ON public.kpi_form_templates FOR SELECT USING (get_my_role() IS NOT NULL);
CREATE POLICY "kpi_templates_modify" ON public.kpi_form_templates FOR ALL   USING (is_admin_or_director());

-- ============================================================
-- 15. KPI DAILY REPORTS
-- ============================================================
CREATE TABLE public.kpi_daily_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id),
  role_key     TEXT NOT NULL,
  report_date  DATE NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, report_date)
);

CREATE TRIGGER kpi_daily_reports_updated_at
  BEFORE UPDATE ON public.kpi_daily_reports
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.kpi_daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_reports_admin"       ON public.kpi_daily_reports FOR ALL    USING (is_admin_or_director());
CREATE POLICY "kpi_reports_select_self" ON public.kpi_daily_reports FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "kpi_reports_insert_self" ON public.kpi_daily_reports FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "kpi_reports_update_self" ON public.kpi_daily_reports FOR UPDATE USING (user_id = auth.uid());

-- ============================================================
-- 16. TARGETS
-- ============================================================
CREATE TABLE public.targets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('company','role','user')),
  scope_user_id  UUID REFERENCES public.users(id),
  scope_role_key TEXT,
  metric_key     TEXT NOT NULL,
  period_type    TEXT NOT NULL CHECK (period_type IN ('daily','weekly','monthly','quarterly','annual')),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  target_value   NUMERIC(12,2) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     UUID NOT NULL REFERENCES public.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER targets_updated_at
  BEFORE UPDATE ON public.targets
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "targets_select" ON public.targets FOR SELECT USING (get_my_role() IS NOT NULL);
CREATE POLICY "targets_modify" ON public.targets FOR ALL   USING (is_admin_or_director());

-- ============================================================
-- 17. SAVED DASHBOARD VIEWS
-- ============================================================
CREATE TABLE public.saved_dashboard_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id),
  name       TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'private' CHECK (scope IN ('private','shared')),
  filters    JSONB NOT NULL DEFAULT '{}',
  widgets    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER saved_dashboard_views_updated_at
  BEFORE UPDATE ON public.saved_dashboard_views
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.saved_dashboard_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "views_own"    ON public.saved_dashboard_views FOR ALL    USING (user_id = auth.uid());
CREATE POLICY "views_shared" ON public.saved_dashboard_views FOR SELECT USING (scope = 'shared' AND get_my_role() IS NOT NULL);

-- ============================================================
-- 18. AUDIT LOGS
-- ============================================================
CREATE TABLE public.audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES public.users(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  old_values    JSONB,
  new_values    JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_admin" ON public.audit_logs FOR ALL USING (is_admin_or_director());

-- ============================================================
-- 19. SEED: ROLES
-- ============================================================
INSERT INTO public.roles (key, name, description) VALUES
  ('admin',     'Administrador',  'Acceso total al sistema'),
  ('director',  'Director',       'Gestión completa del equipo comercial'),
  ('setter',    'Setter',         'Generación de citas'),
  ('closer',    'Closer',         'Cierre de ventas'),
  ('affiliate', 'Afiliada',       'Captación de leads por afiliación')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 20. SEED: KPI TEMPLATES
-- ============================================================
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, is_required, sort_order) VALUES
  -- Setter
  ('setter', 'calls_made',         'Llamadas realizadas',     'number', TRUE,  1),
  ('setter', 'contacts_reached',   'Contactos alcanzados',    'number', TRUE,  2),
  ('setter', 'appointments_set',   'Citas agendadas',         'number', TRUE,  3),
  ('setter', 'appointments_confirmed', 'Citas confirmadas',   'number', FALSE, 4),
  ('setter', 'no_shows',           'No shows',                'number', FALSE, 5),
  -- Closer
  ('closer', 'calls_attended',     'Llamadas atendidas',      'number', TRUE,  1),
  ('closer', 'sales_closed',       'Ventas cerradas',         'number', TRUE,  2),
  ('closer', 'revenue',            'Ingresos (€)',            'number', TRUE,  3),
  ('closer', 'closing_rate',       'Tasa de cierre (%)',      'number', FALSE, 4),
  ('closer', 'refunds',            'Devoluciones',            'number', FALSE, 5),
  -- Admin / Director
  ('admin',  'team_revenue',       'Ingresos equipo (€)',     'number', TRUE,  1),
  ('admin',  'new_sales',          'Nuevas ventas',           'number', TRUE,  2),
  ('admin',  'new_appointments',   'Nuevas citas',            'number', FALSE, 3)
ON CONFLICT (role_key, field_key) DO NOTHING;

-- ============================================================
-- 21. SEED: DEFAULT PRODUCTS (opcional — edita a tu gusto)
-- ============================================================
INSERT INTO public.products (name, description, is_active) VALUES
  ('The Closer Club Formación', 'Programa de formación principal', TRUE)
ON CONFLICT DO NOTHING;

-- El primer administrador se crea después de registrar su cuenta en Auth.
