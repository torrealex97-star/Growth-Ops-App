-- ============================================================
-- MIGRACIÓN v3 — Arquitectura por departamentos (Anexo v2.0)
-- Idempotente: se puede re-ejecutar sin romper nada.
-- Añade: 5 tablas nuevas, ~55 campos, 4 roles, RLS por departamento.
-- ============================================================

-- ------------------------------------------------------------
-- 0. ROLES NUEVOS (Triager, Cold Caller, CSM, Manager)
-- ------------------------------------------------------------
INSERT INTO public.roles (key, name, description) SELECT 'triager','Triager','Cualificación de leads' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='triager');
INSERT INTO public.roles (key, name, description) SELECT 'cold_caller','Cold Caller','Generación de citas en frío' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='cold_caller');
INSERT INTO public.roles (key, name, description) SELECT 'csm','Customer Success','Éxito y retención de alumnos' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='csm');
INSERT INTO public.roles (key, name, description) SELECT 'manager','Manager','Coordinación multi-departamento (lectura amplia)' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='manager');

-- ------------------------------------------------------------
-- 1. TABLA CAMPAÑAS (Marketing / Ads)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  channel          TEXT NOT NULL DEFAULT 'meta_ads',   -- meta_ads/google_ads/tiktok_ads/youtube_ads/linkedin/otro
  type             TEXT,                                -- prospeccion/retargeting/lookalike/brand
  start_date       DATE,
  end_date         DATE,
  budget           NUMERIC(12,2) NOT NULL DEFAULT 0,
  adspend          NUMERIC(12,2) NOT NULL DEFAULT 0,    -- gasto real
  impressions      BIGINT NOT NULL DEFAULT 0,
  clicks           BIGINT NOT NULL DEFAULT 0,
  leads_generated  INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'activa',      -- activa/pausada/finalizada
  ad_source        TEXT,                                -- matching con UTMs
  notes            TEXT,
  created_by       UUID REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS campaigns_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns FOR SELECT USING (get_my_role() IN ('admin','director','manager','marketing','adscripcion'));
DROP POLICY IF EXISTS campaigns_modify ON public.campaigns;
CREATE POLICY campaigns_modify ON public.campaigns FOR ALL USING (get_my_role() IN ('admin','director','marketing')) WITH CHECK (get_my_role() IN ('admin','director','marketing'));

-- ------------------------------------------------------------
-- 2. TABLA GASTOS (Finanzas)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept        TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'otros',   -- publicidad/sueldos/comisiones/herramientas/eventos/cogs/otros
  subcategory    TEXT,
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  expense_date   DATE NOT NULL,
  recurring      BOOLEAN NOT NULL DEFAULT FALSE,
  frequency      TEXT,                            -- mensual/trimestral/anual/puntual
  payment_method TEXT,                            -- tarjeta/transferencia/efectivo/domiciliacion
  status         TEXT NOT NULL DEFAULT 'pagado',  -- pagado/pendiente
  counterparty   TEXT,
  person_id      UUID REFERENCES public.users(id),
  notes          TEXT,
  created_by     UUID REFERENCES public.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS expenses_updated_at ON public.expenses;
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses FOR SELECT USING (get_my_role() IN ('admin','director','manager'));
DROP POLICY IF EXISTS expenses_modify ON public.expenses;
CREATE POLICY expenses_modify ON public.expenses FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ------------------------------------------------------------
-- 3. TABLA ACTIVIDADES / INTERACCIONES (Ventas)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  person_id         UUID REFERENCES public.users(id),
  type              TEXT NOT NULL DEFAULT 'llamada',  -- llamada/whatsapp/email/dm_instagram/sms
  activity_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  direction         TEXT NOT NULL DEFAULT 'saliente', -- saliente/entrante
  result            TEXT,                             -- contactado/no_contesta/buzon/conversacion/cita_agendada
  duration_min      NUMERIC(6,1),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS activities_updated_at ON public.activities;
CREATE TRIGGER activities_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE INDEX IF NOT EXISTS activities_contact_idx ON public.activities(contact_id);
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select ON public.activities FOR SELECT USING (
  is_admin_or_director() OR my_data_scope() = 'team' OR person_id = auth.uid()
);
DROP POLICY IF EXISTS activities_insert ON public.activities;
CREATE POLICY activities_insert ON public.activities FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS activities_update ON public.activities;
CREATE POLICY activities_update ON public.activities FOR UPDATE USING (is_admin_or_director() OR person_id = auth.uid());
DROP POLICY IF EXISTS activities_admin ON public.activities;
CREATE POLICY activities_admin ON public.activities FOR DELETE USING (is_admin_or_director());

-- ------------------------------------------------------------
-- 4. TABLA EVENTOS CSM (Producto / Alumnos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.csm_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,  -- alumno
  sale_id        UUID REFERENCES public.sales(id),                                 -- matrícula
  csm_id         UUID REFERENCES public.users(id),
  type           TEXT NOT NULL DEFAULT 'coaching',  -- onboarding/coaching/revision/graduacion/soporte/otro
  event_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT NOT NULL DEFAULT 'agendado',  -- agendado/confirmado/completado/no_show/cancelado_admin/cancelado_alumno/reagendado
  grade          INT,                               -- 1-10
  success        TEXT,                              -- si/no/parcial
  reminder       TEXT,                              -- enviado/no_enviado/no_aplica
  recording_url  TEXT,
  notes          TEXT,
  created_by     UUID REFERENCES public.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS csm_events_updated_at ON public.csm_events;
CREATE TRIGGER csm_events_updated_at BEFORE UPDATE ON public.csm_events FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE INDEX IF NOT EXISTS csm_events_contact_idx ON public.csm_events(contact_id);
CREATE INDEX IF NOT EXISTS csm_events_sale_idx ON public.csm_events(sale_id);
ALTER TABLE public.csm_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS csm_events_select ON public.csm_events;
CREATE POLICY csm_events_select ON public.csm_events FOR SELECT USING (get_my_role() IN ('admin','director','manager','csm'));
DROP POLICY IF EXISTS csm_events_modify ON public.csm_events;
CREATE POLICY csm_events_modify ON public.csm_events FOR ALL USING (get_my_role() IN ('admin','director','csm')) WITH CHECK (get_my_role() IN ('admin','director','csm'));

-- ------------------------------------------------------------
-- 5. TABLA CANCELACIONES / DROPS (Producto / Alumnos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drops (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          UUID REFERENCES public.sales(id),
  contact_id       UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  request_date     DATE,
  effective_date   DATE,
  reason           TEXT,      -- impago/no_ve_valor/cambio_circunstancias/competencia/mala_experiencia/otro
  reason_detail    TEXT,
  type             TEXT NOT NULL DEFAULT 'voluntaria',  -- voluntaria/impago/refund/pausa
  handled_by       UUID REFERENCES public.users(id),
  retention_action TEXT,
  result           TEXT NOT NULL DEFAULT 'en_proceso',  -- perdida/recuperada/en_proceso/pausada
  refund_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_by       UUID REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS drops_updated_at ON public.drops;
CREATE TRIGGER drops_updated_at BEFORE UPDATE ON public.drops FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE INDEX IF NOT EXISTS drops_sale_idx ON public.drops(sale_id);
ALTER TABLE public.drops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drops_select ON public.drops;
CREATE POLICY drops_select ON public.drops FOR SELECT USING (get_my_role() IN ('admin','director','manager','csm'));
DROP POLICY IF EXISTS drops_modify ON public.drops;
CREATE POLICY drops_modify ON public.drops FOR ALL USING (get_my_role() IN ('admin','director','csm')) WITH CHECK (get_my_role() IN ('admin','director','csm'));

-- ------------------------------------------------------------
-- 6. CAMPOS NUEVOS — USERS (Equipo)
-- ------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS base_salary NUMERIC(12,2);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS monthly_goal NUMERIC(12,2);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS assigned_channel TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS member_status TEXT NOT NULL DEFAULT 'activo';  -- activo/inactivo/prueba

-- ------------------------------------------------------------
-- 7. CAMPOS NUEVOS — CONTACTS (Leads + Alumnos)
-- ------------------------------------------------------------
-- VSL (referenciadas por el tipo Contact y la página de leads, pero nunca creadas en DB)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS vsl_watch_pct NUMERIC;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS vsl_watched_at TIMESTAMPTZ;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_score INT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS contact_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS discard_reason TEXT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.contacts(id);
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id);
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS set_source TEXT;   -- closer/setter/cold_caller/affiliate
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS optin_date DATE;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS age INT;
-- Campos de Alumno (post-venta)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS engagement_score TEXT;   -- bajo/medio/alto
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ttfv_date DATE;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS nps INT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS nps_date DATE;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS promise_fulfilled TEXT;  -- si/no/en_proceso

-- ------------------------------------------------------------
-- 8. CAMPOS NUEVOS — APPOINTMENTS (Citas)
-- ------------------------------------------------------------
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS result TEXT;         -- good_demo/bad_fit/offer_made/deposit/closed/fu_booked/no_qualified/rechazo
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS appointment_type TEXT;  -- primera/follow_up_1/follow_up_2/follow_up_3
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS origin_appointment_id UUID REFERENCES public.appointments(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS event_type TEXT;      -- demo/sales_call/follow_up_call
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS grade INT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triager_id UUID REFERENCES public.users(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cold_caller_id UUID REFERENCES public.users(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES public.users(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pipe_value NUMERIC(12,2);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS offered BOOLEAN;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_deal TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS qualification JSONB; -- Q3..Q10

-- Ampliar estados de cita (Pendiente/Confirmada/No Show/Cancelada Admin/Cancelada Lead/Reagendada/Completada)
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled','confirmed','show','no_show','cancelled','rescheduled','completed','cancelled_admin','cancelled_lead'));

-- ------------------------------------------------------------
-- 9. CAMPOS NUEVOS — SALES (Matrículas)
-- ------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_day1 NUMERIC(12,2);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS is_upsell BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS origin_sale_id UUID REFERENCES public.sales(id);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS from_follow_up BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS processing_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS onboarding_date DATE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS first_coaching_date DATE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS graduation_date DATE;

-- ------------------------------------------------------------
-- 10. CAMPOS NUEVOS — COLLECTIONS (Pagos)
-- ------------------------------------------------------------
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS recovered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS recovered_at DATE;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS processing_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS extra_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS payment_channel TEXT;  -- online/presencial/automatico
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS from_follow_up BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS vat NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS invoice_link TEXT;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS billing_info TEXT;

-- ------------------------------------------------------------
-- 11. CAMPOS NUEVOS — PRODUCTS (Programas)
-- ------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS level INT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS next_product_id UUID REFERENCES public.products(id);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS max_capacity INT;

-- ------------------------------------------------------------
-- 12. SEED KPI TEMPLATES para roles nuevos
-- ------------------------------------------------------------
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'cold_caller','llamadas','Llamadas realizadas','number',1 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='cold_caller' AND field_key='llamadas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'cold_caller','conversaciones','Conversaciones','number',2 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='cold_caller' AND field_key='conversaciones');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'cold_caller','citas_generadas','Citas generadas','number',3 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='cold_caller' AND field_key='citas_generadas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'triager','leads_cualificados','Leads cualificados','number',1 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='triager' AND field_key='leads_cualificados');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'csm','sesiones_realizadas','Sesiones realizadas','number',1 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='csm' AND field_key='sesiones_realizadas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'csm','alumnos_activos','Alumnos activos','number',2 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='csm' AND field_key='alumnos_activos');

-- ============================================================
-- FIN MIGRACIÓN v3
-- ============================================================
