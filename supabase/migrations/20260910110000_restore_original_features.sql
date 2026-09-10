
-- SOURCE: scripts/migration-v2.sql
-- Migración v2 (formato seguro). Copiar DESDE este archivo en el editor, no desde el chat.

DROP POLICY IF EXISTS sales_insert_team ON public.sales;
CREATE POLICY sales_insert_team ON public.sales FOR INSERT WITH CHECK (is_admin_or_director() OR created_by = auth.uid());

DROP POLICY IF EXISTS installments_insert_team ON public.sale_expected_installments;
CREATE POLICY installments_insert_team ON public.sale_expected_installments FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_channel TEXT;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'registrado';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS recording_url TEXT;

INSERT INTO public.roles (key, name) SELECT 'editor','Editor' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key = 'editor');
INSERT INTO public.roles (key, name) SELECT 'marketing','Marketing' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key = 'marketing');

CREATE TABLE IF NOT EXISTS public.content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'otro',
  status TEXT NOT NULL DEFAULT 'idea',
  link_url TEXT,
  publish_date DATE,
  assigned_to UUID REFERENCES public.users(id),
  notes TEXT,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_select ON public.content_items;
CREATE POLICY content_select ON public.content_items FOR SELECT USING (get_my_role() IN ('admin','director','marketing','editor'));

DROP POLICY IF EXISTS content_modify ON public.content_items;
CREATE POLICY content_modify ON public.content_items FOR ALL USING (get_my_role() IN ('admin','director','marketing')) WITH CHECK (get_my_role() IN ('admin','director','marketing'));

DROP POLICY IF EXISTS content_editor_update ON public.content_items;
CREATE POLICY content_editor_update ON public.content_items FOR UPDATE USING (get_my_role() = 'editor') WITH CHECK (get_my_role() = 'editor');

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES public.users(id),
  status TEXT NOT NULL DEFAULT 'pendiente',
  stage TEXT,
  notes TEXT,
  due_date DATE,
  source TEXT NOT NULL DEFAULT 'manual',
  is_proposal BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select_team ON public.tasks;
CREATE POLICY tasks_select_team ON public.tasks FOR SELECT USING (get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS tasks_admin ON public.tasks;
CREATE POLICY tasks_admin ON public.tasks FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

DROP POLICY IF EXISTS tasks_update_assignee ON public.tasks;
CREATE POLICY tasks_update_assignee ON public.tasks FOR UPDATE USING (assignee_id = auth.uid()) WITH CHECK (assignee_id = auth.uid());

INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'setter','contactos_nuevos','Contactos nuevos','number',1 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='setter' AND field_key='contactos_nuevos');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'setter','mensajes_enviados','Mensajes enviados','number',2 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='setter' AND field_key='mensajes_enviados');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'setter','llamadas_realizadas','Llamadas realizadas','number',3 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='setter' AND field_key='llamadas_realizadas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'setter','agendas_generadas','Agendas generadas','number',4 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='setter' AND field_key='agendas_generadas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'closer','calls_realizadas','Calls realizadas','number',1 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='closer' AND field_key='calls_realizadas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'closer','shows','Shows','number',2 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='closer' AND field_key='shows');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'closer','ventas_cerradas','Ventas cerradas','number',3 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='closer' AND field_key='ventas_cerradas');
INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order) SELECT 'closer','cash_collected','Cash collected','number',4 WHERE NOT EXISTS (SELECT 1 FROM public.kpi_form_templates WHERE role_key='closer' AND field_key='cash_collected');

-- SOURCE: scripts/rls-per-user-scope.sql
-- ============================================================
-- Hardening RLS configurable por usuario + función agregada para adscripción
-- Idempotente: se puede re-ejecutar sin romper nada.
-- ============================================================

-- 1) Ajuste de visibilidad por usuario: 'team' (ve todo) | 'own' (solo lo suyo)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS data_scope TEXT NOT NULL DEFAULT 'team'
  CHECK (data_scope IN ('own', 'team'));

-- 2) Helper: devuelve el data_scope del usuario actual
CREATE OR REPLACE FUNCTION public.my_data_scope()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT data_scope FROM public.users WHERE id = auth.uid()), 'own');
$$;

-- 3) Políticas SELECT que respetan el data_scope
--    Admin/director siempre ven todo. 'team' ve todo. 'own' solo sus filas.

-- SALES
DROP POLICY IF EXISTS sales_select_team ON public.sales;
CREATE POLICY sales_select_scope ON public.sales FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
);

-- APPOINTMENTS
DROP POLICY IF EXISTS appointments_select_team ON public.appointments;
CREATE POLICY appointments_select_scope ON public.appointments FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
);

-- CONTACTS (own = contactos ligados a una agenda/venta del usuario)
DROP POLICY IF EXISTS contacts_select_team ON public.contacts;
CREATE POLICY contacts_select_scope ON public.contacts FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR EXISTS (SELECT 1 FROM public.appointments a
             WHERE a.contact_id = contacts.id AND (a.setter_id = auth.uid() OR a.closer_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM public.sales s
             WHERE s.contact_id = contacts.id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid()))
);

-- CONTACT_ATTRIBUTIONS (sigue la visibilidad del contacto)
DROP POLICY IF EXISTS contact_attributions_select_team ON public.contact_attributions;
CREATE POLICY contact_attributions_select_scope ON public.contact_attributions FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR EXISTS (SELECT 1 FROM public.appointments a
             WHERE a.contact_id = contact_attributions.contact_id AND (a.setter_id = auth.uid() OR a.closer_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM public.sales s
             WHERE s.contact_id = contact_attributions.contact_id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid()))
);

-- COLLECTIONS (own = cobros de ventas del usuario)
DROP POLICY IF EXISTS collections_select_team ON public.collections;
CREATE POLICY collections_select_scope ON public.collections FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR EXISTS (SELECT 1 FROM public.sales s
             WHERE s.id = collections.sale_id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid()))
);

-- 4) Función agregada para adscripción (sin PII ni importes individuales)
CREATE OR REPLACE FUNCTION public.attribution_funnel()
RETURNS TABLE(source TEXT, leads BIGINT, appointments BIGINT, sales BIGINT, gross NUMERIC)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH primary_attr AS (
    SELECT ca.contact_id,
           COALESCE(NULLIF(ca.source,''), NULLIF(ca.utm_source,''), 'Directo / Sin atribuir') AS src
    FROM public.contact_attributions ca
    WHERE ca.is_primary = TRUE
  ),
  contact_src AS (
    SELECT c.id AS contact_id, COALESCE(pa.src, 'Directo / Sin atribuir') AS src
    FROM public.contacts c
    LEFT JOIN primary_attr pa ON pa.contact_id = c.id
  ),
  l AS (SELECT src, COUNT(*) AS leads FROM contact_src GROUP BY src),
  ap AS (
    SELECT cs.src, COUNT(*) AS appointments
    FROM contact_src cs JOIN public.appointments a ON a.contact_id = cs.contact_id
    GROUP BY cs.src
  ),
  sl AS (
    SELECT cs.src, COUNT(*) AS sales, SUM(s.gross_amount) AS gross
    FROM contact_src cs JOIN public.sales s ON s.contact_id = cs.contact_id
    WHERE s.status IN ('active','partial_refund')
    GROUP BY cs.src
  )
  SELECT l.src, l.leads, COALESCE(ap.appointments,0), COALESCE(sl.sales,0), COALESCE(sl.gross,0)
  FROM l LEFT JOIN ap USING (src) LEFT JOIN sl USING (src)
  ORDER BY 5 DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.attribution_funnel() TO authenticated, anon;

-- SOURCE: scripts/migration-v3.sql
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

-- SOURCE: scripts/migration-v4.sql
-- ============================================================
-- MIGRACIÓN v4 — IA (facturas, análisis de llamadas), enlace GHL, notas de lead
-- Idempotente.
-- ============================================================

-- --- CONTACTS: ID de GHL para matching fiable del webhook ---
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
CREATE INDEX IF NOT EXISTS contacts_ghl_id_idx ON public.contacts(ghl_contact_id);

-- --- APPOINTMENTS: transcripción + análisis IA ---
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS transcript_drive_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS transcript_status TEXT; -- pendiente/procesando/listo/error
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_call_score INT;      -- 1-10 calidad de la llamada
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_lead_score INT;      -- 1-10 calidad/temperatura del lead
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_suggested_stage TEXT;-- etapa sugerida por la IA
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_analysis JSONB;      -- objeciones, next steps, etc.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;

-- --- EXPENSES: factura adjunta + extracción IA (borrador para revisar) ---
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS ai_extracted JSONB;

-- --- CONTACT NOTES: notas del setter/cold-caller que alimentan el Pipeline ---
CREATE TABLE IF NOT EXISTS public.contact_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.users(id),
  note        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_notes_contact_idx ON public.contact_notes(contact_id);
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_notes_select ON public.contact_notes;
CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS contact_notes_insert ON public.contact_notes;
CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS contact_notes_update ON public.contact_notes;
CREATE POLICY contact_notes_update ON public.contact_notes FOR UPDATE USING (is_admin_or_director() OR author_id = auth.uid());
DROP POLICY IF EXISTS contact_notes_delete ON public.contact_notes;
CREATE POLICY contact_notes_delete ON public.contact_notes FOR DELETE USING (is_admin_or_director() OR author_id = auth.uid());

-- ============================================================
-- FIN v4
-- ============================================================

-- SOURCE: scripts/migration-v5.sql
-- ============================================================
-- MIGRACIÓN v5 — Control de pagos/morosidad, rol Cobros, gastos recurrentes
-- Idempotente.
-- ============================================================

-- --- Rol Cobros (miembro que controla la morosidad) ---
INSERT INTO public.roles (key, name, description)
SELECT 'cobros','Cobros / Morosidad','Control de pagos pendientes y morosidad'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='cobros');

-- --- Cuotas previstas: seguimiento de morosidad ---
ALTER TABLE public.sale_expected_installments ADD COLUMN IF NOT EXISTS flagged_delinquent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sale_expected_installments ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.sale_expected_installments ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

-- --- Gastos automáticos (recurrentes + sueldos): dedupe por origen+periodo ---
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS auto_source TEXT; -- p.ej. 'salary:<userId>' o 'recurring:<expenseId>'
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS period TEXT;      -- 'YYYY-MM'
-- Índice único NO parcial (los gastos manuales tienen auto_source/period NULL y
-- Postgres permite múltiples NULLs; el ON CONFLICT del cron necesita un índice no parcial).
CREATE UNIQUE INDEX IF NOT EXISTS expenses_auto_period_uidx
  ON public.expenses(auto_source, period);

-- --- Cobros puede leer (usa scope de equipo; aseguramos SELECT en cuotas/cobros) ---
-- installments ya tiene installments_select_team (get_my_role() IS NOT NULL) → cobros incluido.
-- collections: garantizar SELECT para cualquier rol autenticado (cobros incluido)
DROP POLICY IF EXISTS collections_select_team ON public.collections;
CREATE POLICY collections_select_team ON public.collections FOR SELECT USING (get_my_role() IS NOT NULL);

-- ============================================================
-- FIN v5
-- ============================================================

-- SOURCE: scripts/migration-v6.sql
-- ============================================================
-- MIGRACIÓN v6 — Tareas (prioridad), Productos (duración), Comisiones por tramos
-- Idempotente.
-- ============================================================

-- Tareas: prioridad/urgencia (para el kanban)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'media'; -- baja/media/alta/urgente

-- Productos: duración del programa (meses) → control de renovación de alumnos
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS duration_months INT;

-- Comisiones por tramos de cash collected + por rep concreto + caducidad
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id); -- rep concreto (null = aplica a todos los de ese tipo)
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS min_cash NUMERIC(12,2) NOT NULL DEFAULT 0;   -- tramo: cash collected acumulado desde
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS max_cash NUMERIC(12,2);                       -- hasta (null = sin límite superior)
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS label TEXT;                                   -- nombre del tramo (opcional)

-- ============================================================
-- FIN v6
-- ============================================================

-- SOURCE: scripts/migration-v7.sql
-- ============================================================
-- MIGRACIÓN v7 — Duración de agenda, UTM first/last, (facturas/devoluciones = app)
-- Idempotente.
-- ============================================================

-- Agendas: duración de la reunión en minutos
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_minutes INT;

-- Atribución: UTMs de primer contacto (first touch) y último (last touch)
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_source TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_medium TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_campaign TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_content TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_term TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_source TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_medium TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_campaign TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_content TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_term TEXT;

-- ============================================================
-- FIN v7
-- ============================================================

-- SOURCE: scripts/migration-v8.sql
-- ============================================================
-- MIGRACIÓN v8 — Seed de campos KPI para PROSPECCIÓN (outreach)
-- Alimenta el dashboard de Prospección desde kpi_daily_reports (JSONB, sin schema change).
-- Idempotente.
-- ============================================================
DO $$
DECLARE
  r TEXT;
  roles TEXT[] := ARRAY['setter','cold_caller','triager'];
  fields TEXT[][] := ARRAY[
    ['horas','Horas trabajadas'],
    ['leads_asignados','Leads asignados'],
    ['leads_validos','Leads válidos'],
    ['intentos','Intentos de contacto'],
    ['respuestas','Respuestas'],
    ['conversaciones','Conversaciones'],
    ['ofertas','Ofertas'],
    ['citas_agendadas','Citas agendadas'],
    ['depositos','Depósitos']
  ];
  f TEXT[];
  i INT;
BEGIN
  FOREACH r IN ARRAY roles LOOP
    FOR i IN 1 .. array_length(fields,1) LOOP
      f := fields[i:i][1:2];
      INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order)
      SELECT r, fields[i][1], fields[i][2], 'number', 10 + i
      WHERE NOT EXISTS (
        SELECT 1 FROM public.kpi_form_templates WHERE role_key = r AND field_key = fields[i][1]
      );
    END LOOP;
  END LOOP;
END $$;

-- SOURCE: scripts/migration-v9.sql
-- ============================================================
-- MIGRACIÓN v9 — Socios y reparto de beneficios
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.partners (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  user_id        UUID REFERENCES public.users(id),
  profit_percent NUMERIC(5,2) NOT NULL DEFAULT 0,  -- % del beneficio neto (tras TODOS los gastos)
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS partners_updated_at ON public.partners;
CREATE TRIGGER partners_updated_at BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partners_select ON public.partners;
CREATE POLICY partners_select ON public.partners FOR SELECT USING (get_my_role() IN ('admin','director','manager'));
DROP POLICY IF EXISTS partners_modify ON public.partners;
CREATE POLICY partners_modify ON public.partners FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Seed de los 3 socios (solo si la tabla está vacía)
INSERT INTO public.partners (name, profit_percent)
SELECT * FROM (VALUES
  ('Adrián Martínez', 55.00),
  ('Alex', 30.00),
  ('Jesús Peña', 15.00)
) AS v(name, profit_percent)
WHERE NOT EXISTS (SELECT 1 FROM public.partners);

-- ============================================================
-- FIN v9
-- ============================================================

-- SOURCE: scripts/migration-v10.sql
-- ============================================================
-- MIGRACIÓN v10 — Métodos de pago reales IA WINNERS + reserva + comisiones plataforma
-- Idempotente.
-- ============================================================

-- payment_plans: método, coste de plataforma y recargo de autofinanciación
ALTER TABLE public.payment_plans ADD COLUMN IF NOT EXISTS method TEXT;                          -- stripe/transferencia/autofinanciado/sequra/reserva
ALTER TABLE public.payment_plans ADD COLUMN IF NOT EXISTS fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0;             -- % coste plataforma/financiera sobre lo cobrado
ALTER TABLE public.payment_plans ADD COLUMN IF NOT EXISTS financing_surcharge_percent NUMERIC(5,2) NOT NULL DEFAULT 0; -- recargo de autofinanciación (informativo)

-- sales: importe de reserva ya pagado (se descuenta al completar el pago)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reservation_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- Rehacer los planes del producto de 6 meses
-- ============================================================
DO $$
DECLARE pid UUID;
BEGIN
  SELECT id INTO pid FROM public.products WHERE name LIKE 'Academia IA Winners - Master IA Expert (6 meses)%' LIMIT 1;
  IF pid IS NULL THEN RAISE NOTICE 'Producto 6 meses no encontrado'; RETURN; END IF;

  -- Limpiar planes previos (incluye los "X plazos (Sequra)" erróneos y el Full Pay antiguo)
  DELETE FROM public.payment_plans WHERE product_id = pid;

  INSERT INTO public.payment_plans
    (product_id, name, code, gross_price, number_of_payments, method, fee_percent, financing_surcharge_percent, cash_collection_ratio, is_active, sort_order) VALUES
    (pid, 'Reserva (300€)',              'RES',   300.00, 1, 'reserva',        0,    0,   1.0000, TRUE, 0),
    (pid, 'Full Pay Stripe',             'FPS',  1997.00, 1, 'stripe',         5.00, 0,   0.9500, TRUE, 1),
    (pid, 'Full Pay Transferencia',      'FPT',  1997.00, 1, 'transferencia',  3.00, 0,   0.9700, TRUE, 2),
    (pid, 'Autofinanciado 2 pagos',      'AF2',  2296.55, 2, 'autofinanciado', 5.00, 15,  0.9500, TRUE, 3),
    (pid, 'Autofinanciado 3 pagos',      'AF3',  2346.48, 3, 'autofinanciado', 5.00, 17.5,0.9500, TRUE, 4),
    (pid, 'Autofinanciado 4 pagos',      'AF4',  2396.40, 4, 'autofinanciado', 5.00, 20,  0.9500, TRUE, 5),
    (pid, 'Sequra 3 plazos',             'SEQ3', 1997.00, 3, 'sequra',         30.00,0,   0.7000, TRUE, 6),
    (pid, 'Sequra 6 plazos',             'SEQ6', 1997.00, 6, 'sequra',         30.00,0,   0.7000, TRUE, 7),
    (pid, 'Sequra 9 plazos',             'SEQ9', 1997.00, 9, 'sequra',         30.00,0,   0.7000, TRUE, 8),
    (pid, 'Sequra 12 plazos',            'SEQ12',1997.00,12, 'sequra',         30.00,0,   0.7000, TRUE, 9);
END $$;

-- SOURCE: scripts/migration-v12.sql
-- ============================================================
-- MIGRACIÓN v12 — Afiliados, acceso por departamento, contratos, gestoría
-- Idempotente.
-- ============================================================

-- Rol gestoría (perfil para la gestora)
INSERT INTO public.roles (key, name, description) SELECT 'gestoria','Gestoría','Acceso a facturas e I&G para contabilidad' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key='gestoria');

-- Afiliado: código (utm_content que lo identifica)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS affiliate_code TEXT;

-- Acceso por departamento configurable por usuario (override; si NULL usa el del rol)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dept_overrides TEXT[];

-- Contratos: biblioteca
CREATE TABLE IF NOT EXISTS public.contracts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID REFERENCES public.sales(id),
  contact_id  UUID REFERENCES public.contacts(id),
  title       TEXT,
  url         TEXT,
  status      TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente/enviado/firmado
  signed_at   TIMESTAMPTZ,
  notes       TEXT,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS contracts_updated_at ON public.contracts;
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE INDEX IF NOT EXISTS contracts_sale_idx ON public.contracts(sale_id);
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_select ON public.contracts;
CREATE POLICY contracts_select ON public.contracts FOR SELECT USING (get_my_role() IN ('admin','director','manager','gestoria','csm'));
DROP POLICY IF EXISTS contracts_modify ON public.contracts;
CREATE POLICY contracts_modify ON public.contracts FOR ALL USING (get_my_role() IN ('admin','director','csm')) WITH CHECK (get_my_role() IN ('admin','director','csm'));

-- ============================================================
-- FIN v12
-- ============================================================

-- SOURCE: scripts/migration-v13.sql
-- v13 — Reservas: enlazar la venta completada con su reserva de origen
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS converted_from_reservation_id UUID REFERENCES public.sales(id);

-- SOURCE: scripts/migration-v14.sql
-- v14 — Calendly avanzado + Enlaces
-- Auto-descubrimiento de preguntas de formulario
CREATE TABLE IF NOT EXISTS public.qualification_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  question_text TEXT,
  field_key TEXT,               -- si mapea a un campo (p.ej. 'edad'→contacts.age)
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.qualification_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qq_select ON public.qualification_questions;
CREATE POLICY qq_select ON public.qualification_questions FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS qq_all ON public.qualification_questions;
CREATE POLICY qq_all ON public.qualification_questions FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Código de tracking por usuario (utm_term para setters/cold_callers, utm_content para afiliados)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tracking_code TEXT;

-- Datos de Calendly en la agenda
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reschedule_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendly_event_uuid TEXT;

-- Plantillas de enlace (Agenda, VSL, etc.)
CREATE TABLE IF NOT EXISTS public.link_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  applies_to TEXT[] NOT NULL DEFAULT ARRAY['setter','cold_caller','affiliate'],  -- roles a los que genera enlace
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS link_templates_updated_at ON public.link_templates;
CREATE TRIGGER link_templates_updated_at BEFORE UPDATE ON public.link_templates FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.link_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lt_select ON public.link_templates;
CREATE POLICY lt_select ON public.link_templates FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS lt_modify ON public.link_templates;
CREATE POLICY lt_modify ON public.link_templates FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- SOURCE: scripts/migration-v15.sql
-- Migration v15 — Pagos: autofinanciado con entrada + cuotas, y reserva → completar pago en la MISMA venta
-- (para portar a The Closer Club)

-- Entrada (down payment) pagada al momento en un plan autofinanciado
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Fecha de la primera cuota del resto (cuando empieza el calendario de cuotas)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS installments_start_date DATE;

-- Nº de cuotas en las que se divide el resto (override del plan si es un trato especial)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS installments_count INT;

-- Cuándo se completó el pago de una reserva (NULL = reserva abierta pendiente de completar)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reservation_completed_at TIMESTAMPTZ;

-- Método de pago elegido (registro explícito, p.ej. "transferencia", "autofinanciado", "stripe")
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- SOURCE: scripts/migration-v16.sql
-- ============================================================
-- v16 — Contratos de equipo con firma digital nativa
--   · contract_templates: plantillas de contrato (cuerpo con variables)
--   · contracts: se amplía para contratos de MIEMBRO (user_id), con
--     condiciones confirmadas (terms JSONB), token de firma, snapshot del
--     cuerpo, PDF firmado en Blob y evidencias de la firma (IP/UA/hash).
-- La firma de la EMPRESA (IA WINNERS) es fija y se estampa automáticamente;
-- solo firma el miembro del equipo. Queda registrado quién dio el alta
-- (contracts.created_by).
-- ============================================================

-- ---------- Plantillas ----------
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  role_key    TEXT,                       -- rol sugerido (setter/closer/...) — informativo
  body        TEXT NOT NULL,              -- cuerpo con variables {{nombre}}, {{fijo}}, ...
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS contract_templates_updated_at ON public.contract_templates;
CREATE TRIGGER contract_templates_updated_at BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_templates_select ON public.contract_templates;
CREATE POLICY contract_templates_select ON public.contract_templates FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','gestoria','csm'));
DROP POLICY IF EXISTS contract_templates_modify ON public.contract_templates;
CREATE POLICY contract_templates_modify ON public.contract_templates FOR ALL
  USING (get_my_role() IN ('admin','director'))
  WITH CHECK (get_my_role() IN ('admin','director'));

-- ---------- Ampliación de contracts (contratos de equipo) ----------
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS user_id         UUID REFERENCES public.users(id);
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS template_id     UUID REFERENCES public.contract_templates(id);
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS kind            TEXT NOT NULL DEFAULT 'venta';  -- 'venta' | 'equipo'
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signing_token   TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS terms           JSONB;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS body_snapshot   TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS sent_at         TIMESTAMPTZ;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_name     TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_ip       TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_user_agent TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signed_hash     TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signed_pdf_url  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS contracts_signing_token_idx
  ON public.contracts(signing_token) WHERE signing_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_user_idx ON public.contracts(user_id);

-- ---------- Plantilla por defecto (setter/closer) ----------
INSERT INTO public.contract_templates (name, role_key, body)
SELECT 'Contrato colaborador comercial (setter/closer)', 'closer',
$tpl$CONTRATO DE PRESTACIÓN DE SERVICIOS COMERCIALES

REUNIDOS

De una parte, {{empresa}}, con CIF {{cif}}, en adelante "LA EMPRESA".
De otra parte, {{nombre}}, con email {{email}}{{telefono_clause}}, en adelante "EL COLABORADOR".

Ambas partes se reconocen capacidad legal suficiente y acuerdan lo siguiente.

PRIMERA — OBJETO
El Colaborador prestará servicios comerciales para La Empresa en el rol de {{rol}}, con fecha de alta {{fecha}}.

SEGUNDA — CONDICIONES ECONÓMICAS
Las condiciones económicas (retribución fija y comisiones por objetivos) son las detalladas en el apartado "CONDICIONES ECONÓMICAS ACORDADAS" de este documento, que forma parte inseparable del presente contrato.

TERCERA — LIQUIDACIÓN
Las comisiones se liquidan sobre el cash collected según los tramos acordados y se abonan el mes siguiente al cobro efectivo, conforme a las reglas internas de comisiones de La Empresa.

CUARTA — CONFIDENCIALIDAD
El Colaborador se compromete a mantener la confidencialidad de la información, procesos, contactos y datos de clientes a los que tenga acceso, durante y después de la relación.

QUINTA — DURACIÓN Y EXTINCIÓN
La relación tiene carácter mercantil y podrá extinguirse por cualquiera de las partes con un preaviso de quince (15) días.

Y en prueba de conformidad, el Colaborador firma el presente contrato de forma electrónica.$tpl$
WHERE NOT EXISTS (SELECT 1 FROM public.contract_templates);

-- ============================================================
-- FIN v16
-- ============================================================

-- SOURCE: scripts/migration-v17.sql
-- ============================================================
-- v17 — Datos de empresa configurables + datos del firmante + envío email
--   · company_profile: fila única con los datos de la empresa que se mapean
--     en los contratos (nombre, CIF, dirección, representante, firma email…).
--   · contracts: datos que completa el firmante (signer_data), rol elegido
--     para el contrato (contract_role) y sello de envío de email.
--   · users: dni y address para persistir lo que rellena el colaborador.
-- ============================================================

-- ---------- Datos de la empresa (única fila, id=1) ----------
CREATE TABLE IF NOT EXISTS public.company_profile (
  id              INT PRIMARY KEY DEFAULT 1,
  name            TEXT NOT NULL DEFAULT 'IA WINNERS',
  legal_name      TEXT,
  cif             TEXT,
  address         TEXT,
  postal_code     TEXT,
  city            TEXT,
  country         TEXT DEFAULT 'España',
  representative  TEXT,
  email           TEXT,
  phone           TEXT,
  logo_url        TEXT,
  email_signature TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_profile_singleton CHECK (id = 1)
);
DROP TRIGGER IF EXISTS company_profile_updated_at ON public.company_profile;
CREATE TRIGGER company_profile_updated_at BEFORE UPDATE ON public.company_profile
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

INSERT INTO public.company_profile (id, name, legal_name, cif)
VALUES (1, 'IA WINNERS', 'IA WINNERS', 'B-00000000')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_profile_select ON public.company_profile;
CREATE POLICY company_profile_select ON public.company_profile FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','gestoria','csm'));
DROP POLICY IF EXISTS company_profile_modify ON public.company_profile;
CREATE POLICY company_profile_modify ON public.company_profile FOR ALL
  USING (get_my_role() IN ('admin','director'))
  WITH CHECK (get_my_role() IN ('admin','director'));

-- ---------- Contratos: datos del firmante + rol + email ----------
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_data   JSONB;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS contract_role TEXT;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

-- ---------- Usuarios: DNI y dirección persistentes ----------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dni     TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address TEXT;

-- ============================================================
-- FIN v17
-- ============================================================

-- SOURCE: scripts/migration-v18.sql
-- v18 — Programa de Afiliados
--   · Registro público con alta automática (formulario configurable por admin)
--   · Campañas de afiliados (enlaces por evento/lanzamiento/VSL) — SEPARADAS de la tabla `campaigns` de marketing
--   · Asignación (masiva) de afiliados a campañas
--   · Ajustes del programa: % de comisión por defecto + campos del formulario
--
-- Requiere helpers existentes: get_my_role(), is_admin_or_director(), handle_updated_at()

-- ------------------------------------------------------------
-- 1. CAMPAÑAS DE AFILIADOS (los enlaces que se comparten)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'otro',   -- evento / lanzamiento / vsl / otro
  base_url    TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS affiliate_campaigns_updated_at ON public.affiliate_campaigns;
CREATE TRIGGER affiliate_campaigns_updated_at BEFORE UPDATE ON public.affiliate_campaigns FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.affiliate_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ac_select ON public.affiliate_campaigns;
CREATE POLICY ac_select ON public.affiliate_campaigns FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS ac_modify ON public.affiliate_campaigns;
CREATE POLICY ac_modify ON public.affiliate_campaigns FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ------------------------------------------------------------
-- 2. ASIGNACIÓN AFILIADO ↔ CAMPAÑA (N:N)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_campaign_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.affiliate_campaigns(id) ON DELETE CASCADE,
  affiliate_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, affiliate_id)
);
CREATE INDEX IF NOT EXISTS acm_campaign_idx  ON public.affiliate_campaign_members(campaign_id);
CREATE INDEX IF NOT EXISTS acm_affiliate_idx ON public.affiliate_campaign_members(affiliate_id);
ALTER TABLE public.affiliate_campaign_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acm_select ON public.affiliate_campaign_members;
-- El afiliado puede ver sus propias asignaciones; liderazgo ve todas.
CREATE POLICY acm_select ON public.affiliate_campaign_members
  FOR SELECT USING (is_admin_or_director() OR affiliate_id = auth.uid());
DROP POLICY IF EXISTS acm_modify ON public.affiliate_campaign_members;
CREATE POLICY acm_modify ON public.affiliate_campaign_members FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ------------------------------------------------------------
-- 3. PERFIL DE AFILIADO (datos extra del formulario de registro)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  user_id       UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  instagram     TEXT,
  audience_size TEXT,
  niche         TEXT,
  source        TEXT,          -- "cómo nos conoció"
  motivation    TEXT,
  extra         JSONB,         -- respuestas de campos personalizados añadidos por el admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS affiliate_profiles_updated_at ON public.affiliate_profiles;
CREATE TRIGGER affiliate_profiles_updated_at BEFORE UPDATE ON public.affiliate_profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ap_select ON public.affiliate_profiles;
CREATE POLICY ap_select ON public.affiliate_profiles
  FOR SELECT USING (is_admin_or_director() OR user_id = auth.uid());
DROP POLICY IF EXISTS ap_modify ON public.affiliate_profiles;
CREATE POLICY ap_modify ON public.affiliate_profiles
  FOR ALL USING (is_admin_or_director() OR user_id = auth.uid())
  WITH CHECK (is_admin_or_director() OR user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. AJUSTES DEL PROGRAMA (singleton id=1)
--    default_commission_percent + configuración del formulario público
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_program_settings (
  id                          INT PRIMARY KEY DEFAULT 1,
  default_commission_percent  NUMERIC(5,2) NOT NULL DEFAULT 20,
  program_name                TEXT NOT NULL DEFAULT 'Programa de Afiliados',
  intro                       TEXT NOT NULL DEFAULT 'Únete a nuestro programa de afiliados. Rellena tus datos y te damos de alta al instante.',
  success_message             TEXT NOT NULL DEFAULT '¡Listo! Te hemos enviado un email para crear tu contraseña y acceder a tu panel.',
  form_fields                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{key,label,enabled,required}]
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT affiliate_program_settings_singleton CHECK (id = 1)
);
DROP TRIGGER IF EXISTS affiliate_program_settings_updated_at ON public.affiliate_program_settings;
CREATE TRIGGER affiliate_program_settings_updated_at BEFORE UPDATE ON public.affiliate_program_settings FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE public.affiliate_program_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aps_select ON public.affiliate_program_settings;
CREATE POLICY aps_select ON public.affiliate_program_settings FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS aps_modify ON public.affiliate_program_settings;
CREATE POLICY aps_modify ON public.affiliate_program_settings FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Fila por defecto con el set de campos inicial (el admin lo edita después).
INSERT INTO public.affiliate_program_settings (id, form_fields)
VALUES (
  1,
  '[
    {"key":"full_name","label":"Nombre completo","enabled":true,"required":true,"fixed":true},
    {"key":"email","label":"Email","enabled":true,"required":true,"fixed":true},
    {"key":"phone","label":"Teléfono (WhatsApp)","enabled":true,"required":true},
    {"key":"instagram","label":"Instagram / red principal","enabled":true,"required":true},
    {"key":"audience_size","label":"Tamaño de tu audiencia","enabled":true,"required":false},
    {"key":"niche","label":"Nicho / a qué te dedicas","enabled":true,"required":false},
    {"key":"source","label":"¿Cómo nos conociste?","enabled":true,"required":false}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- SOURCE: scripts/migration-v19-meta.sql
-- v19 — Integración Meta Marketing API en `campaigns`.
-- Columnas para volcar automáticamente las campañas de Meta y comparar leads.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS provider TEXT;              -- 'meta' | null (manual)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS external_id TEXT;           -- id de la campaña en Meta
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS reach INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS meta_leads INTEGER NOT NULL DEFAULT 0;   -- leads que reporta Meta
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS funnel_leads INTEGER NOT NULL DEFAULT 0; -- leads reales en la app (cruce UTM)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;      -- última sincronización con Meta

-- Upsert idempotente por (provider, external_id): evita duplicar campañas de Meta.
-- OJO: índice NO parcial. Un índice parcial (WHERE ...) NO sirve para ON CONFLICT
-- sin repetir el predicado, y Supabase no lo genera. Los NULL se consideran
-- distintos, así que las campañas manuales (provider/external_id NULL) no colisionan.
DROP INDEX IF EXISTS public.campaigns_provider_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_provider_external_idx
  ON public.campaigns (provider, external_id);

-- SOURCE: scripts/migration-v20.sql
-- v20 — Enlace de registro por campaña de afiliados
--   · Cada campaña tiene un `registration_slug`: token del enlace público que el admin comparte.
--   · Al abrir el enlace y registrarse:
--       - si el email YA es usuario → solo se le asigna la campaña (affiliate_campaign_members)
--       - si NO existe → se crea la cuenta de afiliado (alta automática) y se le asigna a la campaña
--   · Reutiliza el formulario público existente (/evergreen/afiliados/registro) añadiendo ?c=<slug>.

ALTER TABLE public.affiliate_campaigns
  ADD COLUMN IF NOT EXISTS registration_slug TEXT;

-- Backfill: genera un slug corto y único para las campañas ya existentes.
UPDATE public.affiliate_campaigns
SET registration_slug = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
WHERE registration_slug IS NULL;

-- Único (permite múltiples NULL en Postgres, pero la app siempre lo rellena al crear).
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_campaigns_reg_slug_idx
  ON public.affiliate_campaigns(registration_slug);

-- SOURCE: scripts/migration-v21-suggestions.sql
-- v21 — Sugerencias y mejoras de la plataforma
--   · Cualquier usuario autenticado puede enviar una sugerencia, reporte de
--     error o comentario sobre la app desde el propio panel.
--   · El admin/director ve todas las sugerencias en un listado y gestiona su
--     estado (nueva → en revisión → planificada → en progreso → resuelta /
--     descartada) para ir mejorando y corrigiendo la plataforma.

CREATE TABLE IF NOT EXISTS public.suggestions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'mejora'
                CHECK (type IN ('mejora', 'error', 'comentario')),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'nueva'
                CHECK (status IN ('nueva', 'en_revision', 'planificada', 'en_progreso', 'resuelta', 'descartada')),
  admin_notes TEXT,
  page_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suggestions_status_idx  ON public.suggestions(status);
CREATE INDEX IF NOT EXISTS suggestions_user_idx    ON public.suggestions(user_id);
CREATE INDEX IF NOT EXISTS suggestions_created_idx ON public.suggestions(created_at DESC);

DROP TRIGGER IF EXISTS suggestions_updated_at ON public.suggestions;
CREATE TRIGGER suggestions_updated_at
  BEFORE UPDATE ON public.suggestions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado crea sugerencias a su nombre.
DROP POLICY IF EXISTS "suggestions_insert_self" ON public.suggestions;
CREATE POLICY "suggestions_insert_self" ON public.suggestions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- El autor ve las suyas; admin/director ven todas.
DROP POLICY IF EXISTS "suggestions_select" ON public.suggestions;
CREATE POLICY "suggestions_select" ON public.suggestions
  FOR SELECT USING (user_id = auth.uid() OR is_admin_or_director());

-- Solo admin/director gestionan estado y notas / eliminan.
DROP POLICY IF EXISTS "suggestions_update_admin" ON public.suggestions;
CREATE POLICY "suggestions_update_admin" ON public.suggestions
  FOR UPDATE USING (is_admin_or_director());

DROP POLICY IF EXISTS "suggestions_delete_admin" ON public.suggestions;
CREATE POLICY "suggestions_delete_admin" ON public.suggestions
  FOR DELETE USING (is_admin_or_director());

-- SOURCE: scripts/migration-v22-instagram.sql
-- v22 — Instagram orgánico (@adrian.martinez.s).
-- Vuelca los reels/posts con sus métricas, el crecimiento diario de la cuenta,
-- la demografía de la audiencia, los comentarios y las conversaciones (DMs).
-- Poblado por lib/instagram/sync.ts (endpoints /api/evergreen/instagram/sync y
-- /api/evergreen/cron/instagram). El sync usa service-role, así que RLS solo
-- afecta a la lectura desde la app (marketing/dirección).
-- Requiere helpers existentes: get_my_role(), is_admin_or_director(), handle_updated_at().
SET check_function_bodies = false;

-- ── Reels / posts con sus métricas de rendimiento ────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,                       -- id del media en Instagram
  media_type TEXT,                                 -- VIDEO / IMAGE / CAROUSEL_ALBUM
  media_product_type TEXT,                         -- REELS / FEED / STORY
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  media_url TEXT,                                  -- URL del vídeo (para transcribir)
  published_at TIMESTAMPTZ,
  reach INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,                -- reproducciones (métrica actual de reels)
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  total_interactions INTEGER NOT NULL DEFAULT 0,
  avg_watch_time NUMERIC NOT NULL DEFAULT 0,       -- ms (ig_reels_avg_watch_time)
  reach_followers INTEGER NOT NULL DEFAULT 0,      -- reach de seguidores
  reach_non_followers INTEGER NOT NULL DEFAULT 0,  -- reach de NO seguidores = descubrimiento
  follows INTEGER NOT NULL DEFAULT 0,              -- seguidores que generó este reel (si disponible)
  engagement_rate NUMERIC NOT NULL DEFAULT 0,      -- total_interactions / reach
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pendiente', -- pendiente/procesando/listo/error/no_aplica
  ai_analysis JSONB,                               -- {hook, estructura, tema, por_que_funciona, tags[]}
  ai_analyzed_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_media_external_idx ON public.ig_media (external_id);
CREATE INDEX IF NOT EXISTS ig_media_published_idx ON public.ig_media (published_at DESC);

-- ── Snapshot diario de la cuenta (crecimiento) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_account_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  followers_count INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  profile_views INTEGER NOT NULL DEFAULT 0,
  new_follows INTEGER NOT NULL DEFAULT 0,          -- follows del día (si follows_and_unfollows disponible)
  unfollows INTEGER NOT NULL DEFAULT 0,
  reach_followers INTEGER NOT NULL DEFAULT 0,
  reach_non_followers INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_account_daily_date_idx ON public.ig_account_daily (snapshot_date);

-- ── Demografía de la audiencia (último snapshot por dimensión+bucket) ─────────
CREATE TABLE IF NOT EXISTS public.ig_audience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension TEXT NOT NULL,                         -- country / city / age / gender
  bucket TEXT NOT NULL,                            -- ES / Madrid / 25-34 / F ...
  value INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_audience_dim_idx ON public.ig_audience (dimension, bucket);

-- ── Comentarios (fase 2b — mina de ideas / sentimiento) ──────────────────────
CREATE TABLE IF NOT EXISTS public.ig_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  media_external_id TEXT,
  username TEXT,
  text TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  commented_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_comments_external_idx ON public.ig_comments (external_id);
CREATE INDEX IF NOT EXISTS ig_comments_media_idx ON public.ig_comments (media_external_id);

-- ── Conversaciones / DMs — snapshot diario (fase 3) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_conversations_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  total_conversations INTEGER NOT NULL DEFAULT 0,
  unread_conversations INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  unique_people INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_conversations_daily_date_idx ON public.ig_conversations_daily (snapshot_date);

-- ── RLS: lectura para dirección/marketing/editor; escritura solo service-role ─
-- (el sync usa service-role y salta RLS; la app lee con la sesión del usuario)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ig_media','ig_account_daily','ig_audience','ig_comments','ig_conversations_daily']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (get_my_role() IN (''admin'',''director'',''manager'',''marketing'',''editor''))',
      t || '_select', t
    );
    -- INSERT/UPDATE/DELETE solo admin/director desde la app (el sync va por service-role).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_modify', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director())',
      t || '_modify', t
    );
  END LOOP;
END $$;

-- SOURCE: scripts/migration-v23.sql
-- ============================================================
-- v23 — Correo personal del colaborador (separado del de empresa)
--   · users.personal_email: correo PERSONAL, se usa SOLO para el contrato
--     (firma + copia). El correo de empresa (users.email) sigue siendo el de
--     login, conexión de calendarios (Calendly/GHL) y todo lo demás.
--   Se puede "marcar" antes de enviar el contrato (al invitar o manual) y se
--   persiste aquí para reutilizarlo en futuros contratos.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS personal_email TEXT;

-- ============================================================
-- FIN v23
-- ============================================================

-- SOURCE: scripts/migration-v23-instagram-content.sql
-- v23 — Instagram/Contenido: métricas de Facebook por reel (cross-post), análisis
-- de competencia (business_discovery), columnas de la vista tabla de Contenido,
-- y un kv genérico (app_settings) para el prompt de estilo de guiones.
-- Requiere helpers existentes: get_my_role(), is_admin_or_director(), handle_updated_at().
SET check_function_bodies = false;

-- ── Reels de la página de Facebook (cross-post del reel de IG) ────────────────
-- Se poblan desde /{page-id}/video_reels. Se emparejan con ig_media por
-- created_time (±minutos) + caption/description en la UI de detalle.
CREATE TABLE IF NOT EXISTS public.fb_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,               -- id del reel/vídeo en Facebook
  description TEXT,
  permalink TEXT,
  created_time TIMESTAMPTZ,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fb_media_external_idx ON public.fb_media (external_id);
CREATE INDEX IF NOT EXISTS fb_media_created_idx ON public.fb_media (created_time DESC);

-- ── Competidores de Instagram (perfiles públicos que vigilamos) ───────────────
CREATE TABLE IF NOT EXISTS public.ig_competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  followers_count INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_competitors_username_idx ON public.ig_competitors (lower(username));

-- ── Reels de competidores (via business_discovery: solo likes+comments) ───────
CREATE TABLE IF NOT EXISTS public.ig_competitor_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES public.ig_competitors(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  caption TEXT,
  media_type TEXT,
  media_product_type TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  engagement_proxy INTEGER NOT NULL DEFAULT 0,   -- likes + comments (no hay views de terceros)
  permalink TEXT,
  media_url TEXT,                                -- URL del vídeo (para transcribir/replicar)
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  transcript TEXT,
  ai_analysis JSONB,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_competitor_media_external_idx ON public.ig_competitor_media (external_id);
CREATE INDEX IF NOT EXISTS ig_competitor_media_comp_idx ON public.ig_competitor_media (competitor_id);
CREATE INDEX IF NOT EXISTS ig_competitor_media_eng_idx ON public.ig_competitor_media (engagement_proxy DESC);

-- ── Columnas nuevas de content_items para la vista tabla ──────────────────────
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS solution_explanation TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS solution_link TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS reference_reel_url TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS reference_transcript TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS our_reel_url TEXT;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS script TEXT;

-- ── Normalización de estados al nuevo flujo ───────────────────────────────────
-- idea | guionizado | grabado | editando | editado | publicado
UPDATE public.content_items SET status = 'editando' WHERE status = 'en_edicion';
UPDATE public.content_items SET status = 'editado'  WHERE status = 'revision';

-- ── app_settings: kv genérico (prompt de estilo, etc.) ────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (key, value)
VALUES ('ig_style_prompt', '{"prompt": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura para dirección/marketing/editor; escritura solo admin/director desde
-- la app (los sync van por service-role y saltan RLS).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fb_media','ig_competitors','ig_competitor_media']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (get_my_role() IN (''admin'',''director'',''manager'',''marketing'',''editor''))',
      t || '_select', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_modify', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (get_my_role() IN (''admin'',''director'',''marketing'')) WITH CHECK (get_my_role() IN (''admin'',''director'',''marketing''))',
      t || '_modify', t
    );
  END LOOP;
END $$;

-- app_settings: lectura marketing/dirección, escritura admin/director
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','editor'));
DROP POLICY IF EXISTS app_settings_modify ON public.app_settings;
CREATE POLICY app_settings_modify ON public.app_settings FOR ALL
  USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- SOURCE: scripts/migration-v24-calendly-bidirectional.sql
-- migration-v24: sincronización bidireccional con Calendly
-- Índice único sobre appointments.external_id para que la creación desde la app
-- (POST /invitees) y el webhook invitee.created reconcilien la misma cita en vez
-- de duplicarla. Los NULL siguen permitiéndose (varias citas manuales sin
-- external_id): en Postgres los NULL se consideran distintos en un índice UNIQUE.

CREATE UNIQUE INDEX IF NOT EXISTS appointments_external_id_key
  ON appointments (external_id);

-- SOURCE: scripts/migration-v24-integration-settings.sql
-- v24 — SaaS Nivel 1: configuración de integraciones editable desde la app.
-- Almacena tokens/keys/cuentas por instalación. Los valores marcados is_secret
-- van CIFRADOS (AES-256-GCM, prefijo enc:v1:) con CONFIG_ENC_KEY; el resto en claro.
-- Se leen SOLO en servidor con service-role (RLS deniega a anon/authenticated).
-- Requiere helper existente: handle_updated_at().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.integration_settings (
  key         TEXT PRIMARY KEY,           -- p.ej. META_ACCESS_TOKEN, IG_USER_ID, RESEND_FROM…
  value       TEXT,                       -- cifrado (enc:v1:…) si is_secret; texto plano si no
  is_secret   BOOLEAN NOT NULL DEFAULT true,
  label       TEXT,                       -- descripción humana (opcional)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID
);

-- Trigger updated_at (si el helper existe en el esquema base)
DROP TRIGGER IF EXISTS integration_settings_updated_at ON public.integration_settings;
CREATE TRIGGER integration_settings_updated_at
  BEFORE UPDATE ON public.integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: nadie (anon/authenticated) accede directo; solo service-role (que salta RLS).
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
-- Sin políticas => acceso denegado por defecto salvo service-role. Los tokens nunca
-- llegan al cliente: la UI lee/escribe a través de endpoints con service-role.

-- SOURCE: scripts/migration-v26-tramos.sql
-- v26 — Tramos (niveles de desbloqueo) de ventas para el dashboard del equipo.
--   · El admin define varios TRAMOS con nombre y umbral. El umbral se mide por
--     Nº DE VENTAS COMPLETADAS (todo cuenta salvo reservas abiertas) o por
--     CASH COLLECTED, según el modo global elegido.
--   · Cada usuario ve en su dashboard su progreso hacia el siguiente tramo y,
--     al alcanzarlo, se celebra con confeti (nivel desbloqueado).
-- Requiere helper existente: handle_updated_at(), get_my_role(), is_admin_or_director().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.sales_tramos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  threshold   NUMERIC(12,2) NOT NULL,   -- umbral: nº de ventas o € de cash collected
  emoji       TEXT,                     -- emoji del nivel (opcional)
  color       TEXT,                     -- color hex del nivel (opcional)
  reward      TEXT,                     -- recompensa/nota del nivel (opcional)
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configuración global (singleton, id=1): modo de medida y periodo.
CREATE TABLE IF NOT EXISTS public.sales_tramos_config (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  metric     TEXT NOT NULL DEFAULT 'sales' CHECK (metric IN ('sales','cash_collected')),
  period     TEXT NOT NULL DEFAULT 'month' CHECK (period IN ('month','all')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.sales_tramos_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS sales_tramos_updated_at ON public.sales_tramos;
CREATE TRIGGER sales_tramos_updated_at BEFORE UPDATE ON public.sales_tramos
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS sales_tramos_config_updated_at ON public.sales_tramos_config;
CREATE TRIGGER sales_tramos_config_updated_at BEFORE UPDATE ON public.sales_tramos_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: cualquier miembro del equipo LEE (ve su progreso); solo admin/director gestionan.
ALTER TABLE public.sales_tramos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_tramos_select ON public.sales_tramos;
CREATE POLICY sales_tramos_select ON public.sales_tramos
  FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS sales_tramos_modify ON public.sales_tramos;
CREATE POLICY sales_tramos_modify ON public.sales_tramos
  FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

ALTER TABLE public.sales_tramos_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_tramos_config_select ON public.sales_tramos_config;
CREATE POLICY sales_tramos_config_select ON public.sales_tramos_config
  FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS sales_tramos_config_modify ON public.sales_tramos_config;
CREATE POLICY sales_tramos_config_modify ON public.sales_tramos_config
  FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- Seed de ejemplo (descomenta y ajusta si quieres arrancar con tramos por defecto):
-- INSERT INTO public.sales_tramos (name, threshold, emoji, sort_order) VALUES
--   ('Nivel 1', 3,  '🥉', 1),
--   ('Nivel 2', 6,  '🥈', 2),
--   ('Nivel 3', 10, '🥇', 3),
--   ('Leyenda', 15, '🏆', 4);

-- SOURCE: scripts/migration-v27-meta-multi-account.sql
-- v27 — Multi-cuenta en Meta Ads.
-- Guarda la cuenta publicitaria (act_XXX) de origen en cada campaña, para poder
-- filtrar el panel por cuenta. El gasto total sigue siendo la suma de todas.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_id TEXT; -- cuenta publicitaria de Meta (act_XXX)

-- Índice para filtrar/agrupar campañas por cuenta de forma eficiente.
CREATE INDEX IF NOT EXISTS campaigns_account_id_idx
  ON public.campaigns (account_id);

-- SOURCE: scripts/migration-v28-ads-funnel.sql
-- v28 — Métricas de funnel de ads en `campaigns`.
-- Amplía la ingesta de Meta (clics de enlace + visitas a la página) y guarda el
-- cruce con el CRM (agendas, llamadas/show-ups, cierres, facturación) por campaña.
-- Todo lo derivado (CPM, CPC, CTR, %Carga, CPL, %Registro, %Conversión VSL,
-- %Show Up, %Cierre, CPA) se calcula en el frontend a partir de estas columnas.

-- Meta (ampliación de insights)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS link_clicks BIGINT NOT NULL DEFAULT 0;   -- inline_link_clicks
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS landing_views BIGINT NOT NULL DEFAULT 0;  -- landing_page_view (actions)

-- CRM (cruce por UTM del contacto → appointments / sales)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS appointments_count INTEGER NOT NULL DEFAULT 0; -- Agendas atribuidas
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS shows_count INTEGER NOT NULL DEFAULT 0;        -- Llamadas (show up: show/completed)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS sales_count INTEGER NOT NULL DEFAULT 0;        -- Cierres (active/partial_refund)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS sales_revenue NUMERIC NOT NULL DEFAULT 0;      -- Facturación atribuida (gross)

-- SOURCE: scripts/migration-v28-meta-account-name.sql
-- v28 — Nombre legible de la cuenta publicitaria de Meta.
-- Guarda el nombre de la cuenta (además del act_XXX) para poder filtrar el panel
-- de Campañas por NOMBRE de cuenta en lugar de por el id numérico.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_name TEXT; -- nombre de la cuenta de Meta

-- SOURCE: scripts/migration-v29-ads-and-followers.sql
-- v29 — Nivel ANUNCIO (drill-down campaña → anuncios) + métrica de SEGUIDORES.
-- · campaigns.followers: seguidores atribuidos por Meta a la campaña (action_type
--   de tipo follow). 0 en campañas que no son de captación de seguidores.
-- · campaign_ads: un registro por anuncio de Meta, con su gasto/leads/seguidores,
--   enlazado a su campaña. Permite ver y filtrar el rendimiento por anuncio.

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS followers INTEGER; -- follows atribuidos (lifetime)

CREATE TABLE IF NOT EXISTS public.campaign_ads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id          TEXT UNIQUE NOT NULL,           -- ad id de Meta
  campaign_external_id TEXT,                            -- campaign id de Meta
  campaign_id          UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  account_id           TEXT,                            -- act_XXX
  account_name         TEXT,                            -- nombre legible de la cuenta
  name                 TEXT NOT NULL,
  adset_name           TEXT,
  status               TEXT,                            -- activa / pausada / finalizada
  spend                NUMERIC DEFAULT 0,
  impressions          BIGINT DEFAULT 0,
  clicks               BIGINT DEFAULT 0,
  reach                BIGINT DEFAULT 0,
  link_clicks          BIGINT DEFAULT 0,
  landing_views        BIGINT DEFAULT 0,
  leads                INTEGER DEFAULT 0,
  followers            INTEGER DEFAULT 0,               -- follows atribuidos al anuncio
  synced_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_ads_campaign_id_idx  ON public.campaign_ads (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_ads_account_id_idx    ON public.campaign_ads (account_id);
CREATE INDEX IF NOT EXISTS campaign_ads_campaign_ext_idx  ON public.campaign_ads (campaign_external_id);

-- RLS idéntica a campaigns (lectura para roles con acceso; escritura solo admin/director/marketing).
ALTER TABLE public.campaign_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_ads_select ON public.campaign_ads;
CREATE POLICY campaign_ads_select ON public.campaign_ads FOR SELECT
  USING (get_my_role() = ANY (ARRAY['admin','director','manager','marketing','adscripcion']));

DROP POLICY IF EXISTS campaign_ads_modify ON public.campaign_ads;
CREATE POLICY campaign_ads_modify ON public.campaign_ads FOR ALL
  USING (get_my_role() = ANY (ARRAY['admin','director','marketing']))
  WITH CHECK (get_my_role() = ANY (ARRAY['admin','director','marketing']));

-- SOURCE: scripts/migration-v29-contratos-alumno.sql
-- ============================================================
-- v29 — Contratos de ALUMNO con firma nativa + onboarding
--   · contracts: estados extra de tracking (leído, accesos enviados/abiertos)
--     y registro del webhook de onboarding a GoHighLevel.
--   · contract_templates: distinción por `kind` (equipo|alumno) + mensaje de
--     bienvenida configurable ("Bienvenido Winner, acepta las condiciones…").
--   · sales: captura/justificante de pago + plan de pagos personalizado.
--   · Plantilla de contrato de ALUMNO por defecto (mini, con condiciones
--     desplegables) y un plan "personalizado" por producto.
-- El flujo de firma reutiliza la infra nativa (signing_token, PDF a Supabase
-- Storage, hash SHA-256, IP). Al firmar, la app dispara el webhook de accesos.
-- ============================================================

-- ---------- Tracking del contrato / onboarding ----------
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS read_at              TIMESTAMPTZ; -- primera apertura del enlace de firma
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS accesos_enviados_at  TIMESTAMPTZ; -- webhook de onboarding disparado
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS accesos_abiertos_at  TIMESTAMPTZ; -- alumno logueado (fase 2, si GHL lo expone)
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS onboarding_webhook_ok BOOLEAN;    -- resultado del webhook a GHL

-- ---------- Plantillas: tipo + mensaje de bienvenida ----------
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS kind            TEXT NOT NULL DEFAULT 'equipo'; -- 'equipo' | 'alumno'
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS welcome_message TEXT; -- cabecera mostrada al alumno antes de aceptar

-- ---------- Ventas: justificante de pago + plan personalizado ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;  -- captura/PDF del pago (Supabase Storage)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS custom_plan       JSONB; -- desglose del plan personalizado

-- ---------- Plantilla de contrato de ALUMNO por defecto ----------
-- Cuerpo legal breve. Las variables {{...}} conocidas se resuelven al generar
-- (empresa/alumno/condiciones) y las del firmante (dni, direccion…) al firmar.
INSERT INTO public.contract_templates (name, kind, role_key, welcome_message, body)
SELECT
  'Contrato de alumno — Academia IA WINNERS',
  'alumno',
  NULL,
  '¡Bienvenido Winner! 🎉 Estás a un clic de entrar en la Academia IA WINNERS. Revisa y acepta las condiciones para recibir tus accesos al instante.',
$tpl$CONTRATO DE FORMACIÓN — ACADEMIA IA WINNERS

REUNIDOS

De una parte, {{empresa}}, con CIF {{cif}}, en adelante "LA ACADEMIA".
De otra parte, {{nombre}}, con DNI/NIE {{dni}} y email {{email}}, en adelante "EL ALUMNO".

Ambas partes se reconocen capacidad legal suficiente y acuerdan lo siguiente.

PRIMERA — OBJETO
La Academia concede al Alumno el acceso al programa formativo "{{producto}}", con una duración de acceso de {{duracion}}, incluyendo los contenidos, comunidad y acompañamiento asociados al mismo.

SEGUNDA — CONDICIONES ECONÓMICAS
El precio del programa y la forma de pago son los detallados en el apartado "CONDICIONES DEL PROGRAMA" de este documento, que forma parte inseparable del presente contrato. El Alumno se compromete al cumplimiento íntegro del plan de pagos acordado.

TERCERA — ACCESO Y NATURALEZA DIGITAL
El Alumno reconoce que el producto es un servicio digital de acceso inmediato. Al firmar el presente contrato y acceder a la plataforma, el Alumno solicita expresamente el inicio de la prestación y comienza a disfrutar del contenido.

CUARTA — DERECHO DE DESISTIMIENTO
De acuerdo con la normativa de consumo, al tratarse de contenido digital cuya ejecución comienza con el consentimiento expreso del Alumno y su acceso inmediato a la plataforma, el Alumno reconoce que decae el derecho de desistimiento una vez iniciado el acceso al contenido.

QUINTA — COMPROMISO DE PAGO
En caso de impago de cualquiera de las cuotas acordadas, La Academia podrá suspender los accesos y reclamar las cantidades pendientes por las vías oportunas, incluyendo la gestión de cobro a través de terceros.

SEXTA — PROPIEDAD INTELECTUAL Y CONFIDENCIALIDAD
Todos los contenidos son propiedad de La Academia. Queda prohibida su reproducción, distribución o cesión a terceros. El Alumno mantendrá la confidencialidad del material y de la comunidad.

SÉPTIMA — PROTECCIÓN DE DATOS
Los datos del Alumno se tratarán conforme al RGPD con la finalidad de gestionar la relación formativa y de pago.

Y en prueba de conformidad, el Alumno acepta las presentes condiciones y firma el contrato de forma electrónica.$tpl$
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_templates WHERE kind = 'alumno'
);

-- ---------- Plan de pagos PERSONALIZADO por producto ----------
-- Baza para casos a medida (ej. "500€ ahora + resto por Sequra en X meses").
-- El desglose real se guarda por venta en sales.custom_plan; el importe efectivo
-- lo lleva sales.gross_amount. ratio=1 (lo cobrado cuenta como cash collected).
INSERT INTO public.payment_plans (product_id, name, code, gross_price, number_of_payments, method, fee_percent, cash_collection_ratio, sort_order, is_active)
SELECT p.id, 'Plan personalizado', 'CUSTOM', 0, 1, 'custom', 0, 1.00, 999, TRUE
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_plans pp WHERE pp.product_id = p.id AND pp.code = 'CUSTOM'
);

-- ============================================================
-- FIN v29
-- ============================================================

-- SOURCE: scripts/migration-v30-commission-tramos.sql
-- v30 — Enlaza las reglas de comisión con los Tramos/niveles de gamificación (sales_tramos).
--   · commission_rules.tramo_id (opcional): si está definido, el % de la regla se aplica cuando
--     el rep tiene ESE tramo desbloqueado (según sales_tramos + sales_tramos_config), en vez de
--     seleccionarse por el tramo de cash collected (min_cash/max_cash).
--   · Idempotente. Requiere que exista la tabla public.sales_tramos (migration-v26-tramos.sql).
SET check_function_bodies = false;

ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS tramo_id UUID REFERENCES public.sales_tramos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS commission_rules_tramo_id_idx ON public.commission_rules(tramo_id);

-- SOURCE: scripts/migration-v32-campaign-daily.sql
-- v32 — Gasto DIARIO por campaña de Meta (serie temporal).
--   Permite filtrar el gasto por rango real (este mes, este trimestre, año…) en vez de mostrar
--   siempre el total histórico. Cada fila = (campaña, día) con gasto/impresiones/clics/leads.
--   Se rellena con el sync diario (/api/evergreen/meta/daily-sync + cron meta-daily).
--   Idempotente. Requiere public.campaigns.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.campaign_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  external_id  TEXT,                       -- id de campaña de Meta
  account_id   TEXT,                       -- cuenta publicitaria (act_XXX)
  date         DATE NOT NULL,
  spend        NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions  BIGINT NOT NULL DEFAULT 0,
  clicks       BIGINT NOT NULL DEFAULT 0,
  leads        INTEGER NOT NULL DEFAULT 0,
  reach        BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS campaign_daily_date_idx ON public.campaign_daily(date);
CREATE INDEX IF NOT EXISTS campaign_daily_campaign_idx ON public.campaign_daily(campaign_id);

-- RLS: cualquier miembro del equipo LEE; las escrituras van por service-role (bypass RLS).
ALTER TABLE public.campaign_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_daily_select ON public.campaign_daily;
CREATE POLICY campaign_daily_select ON public.campaign_daily
  FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS campaign_daily_modify ON public.campaign_daily;
CREATE POLICY campaign_daily_modify ON public.campaign_daily
  FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- SOURCE: scripts/migration-v33-campaign-daily-funnel.sql
-- v33 — Funnel DIARIO: clics de enlace y visitas a la página por día.
--   Amplía campaign_daily con las dos métricas que faltaban para poder construir el
--   "Resumen Diario de Métricas" pedido por el equipo de ads (CTR, CPC, % de carga,
--   coste por visita, tasa de registro… todo por FECHA). Se rellenan con el sync diario
--   (/api/evergreen/meta/daily-sync + cron meta-daily), que ya trae inline_link_clicks y
--   landing_page_view por día. Idempotente. Requiere public.campaign_daily (v32).
SET check_function_bodies = false;

ALTER TABLE public.campaign_daily ADD COLUMN IF NOT EXISTS link_clicks   BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.campaign_daily ADD COLUMN IF NOT EXISTS landing_views BIGINT NOT NULL DEFAULT 0;

-- SOURCE: scripts/migration-v35-commission-invoices.sql
-- v35 — Facturas de comisiones del equipo. Cada closer/setter/afiliado adjunta
--   su factura del mes (PDF en Storage). Solo ve las suyas; admin/director ven todas.
--   Requiere el helper is_admin_or_director() y handle_updated_at() (ya existentes).
--   Idempotente.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.commission_invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,               -- primer día del mes facturado
  invoice_url  TEXT,                         -- PDF en el bucket 'facturas'
  amount       NUMERIC(12,2),                -- importe facturado (informativo)
  status       TEXT NOT NULL DEFAULT 'recibida', -- recibida | pagada
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);

CREATE INDEX IF NOT EXISTS commission_invoices_user_idx ON public.commission_invoices(user_id);
CREATE INDEX IF NOT EXISTS commission_invoices_month_idx ON public.commission_invoices(period_month);

DROP TRIGGER IF EXISTS commission_invoices_updated_at ON public.commission_invoices;
CREATE TRIGGER commission_invoices_updated_at
  BEFORE UPDATE ON public.commission_invoices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.commission_invoices ENABLE ROW LEVEL SECURITY;

-- SELECT: propias o (admin/director) todas.
DROP POLICY IF EXISTS commission_invoices_select ON public.commission_invoices;
CREATE POLICY commission_invoices_select ON public.commission_invoices
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin_or_director());

-- INSERT: solo la propia (o admin/director en nombre de cualquiera).
DROP POLICY IF EXISTS commission_invoices_insert ON public.commission_invoices;
CREATE POLICY commission_invoices_insert ON public.commission_invoices
  FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_admin_or_director());

-- UPDATE: la propia (el comercial puede reemplazar su PDF) o admin/director (marcar pagada).
DROP POLICY IF EXISTS commission_invoices_update ON public.commission_invoices;
CREATE POLICY commission_invoices_update ON public.commission_invoices
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin_or_director())
  WITH CHECK (user_id = auth.uid() OR public.is_admin_or_director());

-- DELETE: la propia o admin/director.
DROP POLICY IF EXISTS commission_invoices_delete ON public.commission_invoices;
CREATE POLICY commission_invoices_delete ON public.commission_invoices
  FOR DELETE USING (user_id = auth.uid() OR public.is_admin_or_director());

-- SOURCE: scripts/migration-v36-extras.sql
-- v36 — Extras/bonus de productos (llamada 1-1, Honey, +1 mes…) que se incluyen en una venta.
--   · product_extras: catálogo editable (admin/director).
--   · sales.extras: array de nombres de extras incluidos en esa venta (para contrato y export).
--   Requiere is_admin_or_director() y handle_updated_at(). Idempotente.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.product_extras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS product_extras_updated_at ON public.product_extras;
CREATE TRIGGER product_extras_updated_at
  BEFORE UPDATE ON public.product_extras
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.product_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_extras_select ON public.product_extras;
CREATE POLICY product_extras_select ON public.product_extras FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS product_extras_modify ON public.product_extras;
CREATE POLICY product_extras_modify ON public.product_extras FOR ALL
  USING (public.is_admin_or_director()) WITH CHECK (public.is_admin_or_director());

-- Extras incluidos en la venta (nombres, denormalizado para contrato/export).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS extras TEXT[];

-- SOURCE: scripts/migration-v37-contact-qualification.sql
-- Migración v37: cualificación (respuestas del formulario) a nivel de contacto.
--
-- Hasta ahora las respuestas del formulario de Calendly vivían solo en
-- appointments.qualification (JSONB), por lo que:
--   - Al reprogramar (fila de cita nueva) se podían perder.
--   - No se podían consultar/agregar por contacto en Atribución ni en el Dashboard.
--
-- Guardamos un snapshot de la última cualificación conocida en el contacto para
-- poder revisar la CALIDAD del lead sin depender de la cita concreta.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS qualification JSONB,
  ADD COLUMN IF NOT EXISTS qualification_updated_at TIMESTAMPTZ;

-- Índice GIN para poder filtrar/consultar por respuestas (p. ej. ingresos, situación).
CREATE INDEX IF NOT EXISTS idx_contacts_qualification ON contacts USING gin (qualification);

-- Backfill: copiamos la cualificación de la cita más reciente (con datos) a cada contacto.
UPDATE contacts c
SET qualification = a.qualification,
    qualification_updated_at = COALESCE(a.appointment_datetime, a.created_at)
FROM (
  SELECT DISTINCT ON (contact_id)
         contact_id, qualification, appointment_datetime, created_at
  FROM appointments
  WHERE qualification IS NOT NULL
    AND qualification <> '{}'::jsonb
    AND (qualification ? 'respuestas')
    AND jsonb_array_length(COALESCE(qualification->'respuestas', '[]'::jsonb)) > 0
  ORDER BY contact_id, COALESCE(appointment_datetime, created_at) DESC
) a
WHERE c.id = a.contact_id
  AND c.qualification IS NULL;

-- SOURCE: scripts/migration-v38-contratos-reserva-tomador-roleplays.sql
-- ============================================================
-- v38 — Reunión socios 2026-07-10
--   (2) Contrato de RESERVA: envía solo el contrato de reserva (sin accesos)
--       y añade una fase propia "contrato de reserva enviado/firmado".
--   (3) Plantillas de contrato asociadas a un MÉTODO DE PAGO: se elige la
--       plantilla del método seleccionado al generar el contrato del alumno.
--   (4) TOMADOR ≠ alumno: el comprador puede ser distinto de quien agenda
--       (madre / empresa / Sequra). Se guardan sus datos, se decide a qué
--       email van los accesos y se genera un contrato de tomador aparte.
--   (7) ROLEPLAYS en la biblioteca de llamadas (material de entrenamiento).
-- ============================================================

-- ---------- (3) Plantillas por método de pago + tipo tomador ----------
-- payment_method: null = plantilla por defecto (cualquier método). Valores:
--   'reserva' | 'sequra' | 'autofinanciado' | 'transferencia' | 'stripe' | 'full_pay' | 'custom'
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- ---------- (2) Marca el contrato como de reserva (no dispara accesos) ----------
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS is_reservation BOOLEAN NOT NULL DEFAULT FALSE;
-- Distingue el contrato del ALUMNO del contrato del TOMADOR dentro de una misma venta.
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS contract_party TEXT NOT NULL DEFAULT 'alumno'; -- 'alumno' | 'tomador'

-- ---------- (4) Tomador (comprador) distinto del agendador ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS buyer_is_scheduler BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payer_data  JSONB;  -- {name,dni,email,phone,address,city,relation}
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS access_email TEXT;   -- email al que se envían los accesos (null = email del contacto)

-- ---------- (7) Roleplays ----------
CREATE TABLE IF NOT EXISTS public.roleplays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  participant_id UUID REFERENCES public.users(id),      -- quién hizo el roleplay
  participant_name TEXT,                                 -- nombre libre si no es usuario
  recording_url TEXT,                                    -- enlace de la grabación
  transcript_url TEXT,                                   -- enlace de la transcripción (Drive, etc.)
  transcript TEXT,                                       -- o texto pegado
  score NUMERIC,                                         -- nota del roleplay (0-10)
  notes TEXT,
  shared BOOLEAN NOT NULL DEFAULT TRUE,                  -- visible para el equipo
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.roleplays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roleplays_select ON public.roleplays;
CREATE POLICY roleplays_select ON public.roleplays FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS roleplays_admin ON public.roleplays;
CREATE POLICY roleplays_admin ON public.roleplays FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ---------- Plantilla de contrato de TOMADOR por defecto ----------
-- El tomador (p.ej. la madre o una empresa) financia/paga la formación de otra
-- persona. Contrato de garantía de pago, más agresivo (avala el pago).
INSERT INTO public.contract_templates (name, kind, role_key, payment_method, welcome_message, body)
SELECT
  'Contrato de tomador — financiación de un tercero',
  'tomador',
  NULL,
  NULL,
  'Estás a punto de aceptar las condiciones como TOMADOR/PAGADOR de la formación. Revisa y acepta para dejar el pago comprometido.',
$tpl$CONTRATO DE PRESTACIÓN Y PAGO POR TERCERO — ACADEMIA IA WINNERS

REUNIDOS

De una parte, {{empresa}}, con CIF {{cif}}, en adelante "LA ACADEMIA".
De otra parte, {{nombre}}, con DNI/NIE {{dni}} y email {{email}}, en adelante "EL TOMADOR/PAGADOR", que asume el pago de la formación del alumno indicado en las condiciones.

Ambas partes se reconocen capacidad legal suficiente y acuerdan lo siguiente.

PRIMERA — OBJETO
El Tomador asume el pago del programa "{{producto}}" contratado para el alumno beneficiario, según el importe y la forma de pago detallados en el apartado "CONDICIONES DEL PROGRAMA".

SEGUNDA — OBLIGACIÓN DE PAGO
El Tomador se obliga al pago íntegro del plan acordado. En caso de impago de cualquier cuota, La Academia podrá reclamar las cantidades pendientes al Tomador por las vías oportunas, incluyendo la gestión de cobro a través de terceros.

TERCERA — NATURALEZA DIGITAL Y DESISTIMIENTO
Al tratarse de contenido digital cuya ejecución comienza con el acceso inmediato del alumno a la plataforma, decae el derecho de desistimiento una vez iniciado dicho acceso.

CUARTA — PROTECCIÓN DE DATOS
Los datos del Tomador se tratarán conforme al RGPD con la finalidad de gestionar el pago y la facturación de la formación.

Y en prueba de conformidad, el Tomador acepta las presentes condiciones y firma el contrato de forma electrónica.$tpl$
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_templates WHERE kind = 'tomador'
);

-- ============================================================
-- FIN v38
-- ============================================================

-- SOURCE: scripts/migration-v39-editor-content-scope.sql
-- v39 — Alcance de contenido para editores.
-- El editor solo VE y solo EDITA las piezas donde figura como editor asignado.
-- Admin / director / marketing conservan acceso total.

DROP POLICY IF EXISTS content_select ON public.content_items;
CREATE POLICY content_select ON public.content_items FOR SELECT USING (
  get_my_role() IN ('admin','director','marketing')
  OR (get_my_role() = 'editor' AND assigned_to = auth.uid())
);

-- La edición amplia (INSERT/UPDATE/DELETE) sigue siendo de admin/director/marketing.
DROP POLICY IF EXISTS content_modify ON public.content_items;
CREATE POLICY content_modify ON public.content_items FOR ALL
  USING (get_my_role() IN ('admin','director','marketing'))
  WITH CHECK (get_my_role() IN ('admin','director','marketing'));

-- El editor solo puede actualizar SUS piezas y no puede reasignarlas a otro
-- (el WITH CHECK obliga a que sigan siendo suyas tras la actualización).
DROP POLICY IF EXISTS content_editor_update ON public.content_items;
CREATE POLICY content_editor_update ON public.content_items FOR UPDATE
  USING (get_my_role() = 'editor' AND assigned_to = auth.uid())
  WITH CHECK (get_my_role() = 'editor' AND assigned_to = auth.uid());

-- SOURCE: scripts/migration-v40-onboarding-tracking.sql
-- v40 — Tracking de onboarding del alumno (webhooks entrantes de GHL)
--   onboarding_scheduled_at : cuándo el alumno AGENDÓ su sesión de onboarding
--                             (marca el estado "Onboarding agendado" en el pipeline).
--   onboarding_session_at   : fecha/hora de la sesión de onboarding reservada.
-- El click en la landing de accesos se guarda en contracts.accesos_abiertos_at (ya existe).

alter table sales add column if not exists onboarding_scheduled_at timestamptz;
alter table sales add column if not exists onboarding_session_at timestamptz;

-- SOURCE: scripts/migration-v41-reels.sql
-- v41 — "Reels del día": bandeja diaria (~5) de borradores de reel minados de las
-- cuentas de competencia ya vigiladas (ig_competitor_media), con guión adaptado
-- (hook + CTA IA WINNERS), transcripción original, enlace al vídeo original y una
-- idea corta de carrusel/flyer. Los escribe el cron (service-role); la app solo lee
-- y actualiza estado vía endpoints service-role.
-- Requiere helpers existentes: get_my_role().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.reel_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_media_id UUID,                    -- ig_competitor_media.id (único para deduplicar)
  source_permalink TEXT,
  source_account TEXT,
  thumbnail_url TEXT,
  caption TEXT,
  transcript TEXT,
  adapted_script TEXT,
  carousel_idea TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobado', 'descartado')),
  gen_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  draft_day DATE NOT NULL DEFAULT current_date,
  created_by UUID REFERENCES public.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS reel_drafts_source_media_idx ON public.reel_drafts (source_media_id) WHERE source_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reel_drafts_day_idx ON public.reel_drafts (draft_day DESC);
CREATE INDEX IF NOT EXISTS reel_drafts_status_idx ON public.reel_drafts (status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura para dirección/marketing/editor (mismo criterio que ig_competitor_media).
-- Las escrituras van siempre por endpoints con service-role, que saltan RLS: no
-- hace falta política de escritura para 'authenticated'.
ALTER TABLE public.reel_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reel_drafts_select ON public.reel_drafts;
CREATE POLICY reel_drafts_select ON public.reel_drafts FOR SELECT
  USING (get_my_role() IN ('admin', 'director', 'manager', 'marketing', 'editor'));

-- SOURCE: scripts/migration-v42-testimonios.sql
-- v42 — Testimonios / casos de éxito: repositorio único de los casos de alumnos y
-- clientes, con foto, enlace al vídeo de YouTube y la estructura punto A → punto B →
-- vehículo. Lo usan (a) los closers para tener el testimonio a mano en llamada y
-- (b) el generador de guiones para añadir prueba social al contenido.
-- Requiere helpers existentes: get_my_role().
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.testimonios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,               -- identificador estable (xavi, maxi, mariapaz…)
  name TEXT NOT NULL,                      -- nombre para mostrar
  kind TEXT NOT NULL DEFAULT 'alumno' CHECK (kind IN ('alumno', 'cliente')),
  avatar TEXT,                             -- avatar al que representa (quemado, agencia, empresario…)
  sector TEXT,                              -- nicho / sector (inmobiliaria, salud, hostelería…)
  photo_url TEXT,
  youtube_url TEXT,                        -- vídeo del testimonio en el canal
  hook TEXT,                               -- frase gancho
  punto_a TEXT,                            -- de dónde venía y qué le dolía
  punto_b TEXT,                            -- dónde está ahora
  vehiculo TEXT,                           -- qué usó exactamente para conseguirlo
  cifra TEXT,                              -- cifra ancla en texto ("23.000€ en 30 días")
  -- false = testimonio de proceso (sin facturación aún). El generador de guiones NO
  -- puede atribuirle cifras económicas.
  has_revenue BOOLEAN NOT NULL DEFAULT true,
  consent BOOLEAN NOT NULL DEFAULT false,  -- consentimiento de imagen/nombre verificado
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS testimonios_active_idx ON public.testimonios (active, sort_order);
CREATE INDEX IF NOT EXISTS testimonios_avatar_idx ON public.testimonios (avatar);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura amplia: los closers y setters los necesitan en llamada. Las escrituras van
-- por endpoints con service-role (saltan RLS), así que no hay política de escritura.
ALTER TABLE public.testimonios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS testimonios_select ON public.testimonios;
CREATE POLICY testimonios_select ON public.testimonios FOR SELECT
  USING (get_my_role() IN ('admin', 'director', 'manager', 'marketing', 'editor', 'setter', 'closer', 'triager', 'cold_caller', 'csm'));

-- SOURCE: scripts/migration-v43-reel-testimonio.sql
-- v43 — Vincula un testimonio a cada borrador de reel, para que el editor sepa qué caso
-- de éxito lleva ese reel y pueda coger su foto, su historia y el vídeo original al montarlo.
-- ON DELETE SET NULL: si se borra un testimonio, el reel se queda sin él pero no se pierde.
SET check_function_bodies = false;

ALTER TABLE public.reel_drafts
  ADD COLUMN IF NOT EXISTS testimonio_id UUID REFERENCES public.testimonios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reel_drafts_testimonio_idx ON public.reel_drafts (testimonio_id)
  WHERE testimonio_id IS NOT NULL;

-- SOURCE: scripts/migration-v44-content-testimonio.sql
-- v44 — Testimonio en el pipeline editorial: cada pieza de contenido puede llevar
-- marcado qué caso de éxito usa, para que el editor sepa de dónde coger la foto, la
-- historia y el vídeo al montarla.
-- El guión generado con prueba social ya llega aquí con el testimonio puesto.
SET check_function_bodies = false;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS testimonio_id UUID REFERENCES public.testimonios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_items_testimonio_idx ON public.content_items (testimonio_id)
  WHERE testimonio_id IS NOT NULL;

-- SOURCE: scripts/migration-v45-appointments-delete-log.sql
-- v45 — Borrado de agendas duplicadas (solo admin).
-- Las agendas duplicadas (reagendas antiguas, dobles entradas de Calendly/GHL) ensucian los KPIs
-- de shows/no-shows. Como TODOS los KPIs leen directamente de public.appointments, la única forma
-- de que una duplicada deje de contar en todas partes es borrar la fila; un "soft delete" obligaría
-- a filtrar en ~15 pantallas y cualquier olvido seguiría inflando métricas.
-- Para que el borrado no sea irreversible, cada fila borrada se guarda aquí como snapshot JSON.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS public.deleted_appointments_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL,               -- id original (sin FK: la fila ya no existe)
  contact_id   UUID,
  snapshot     JSONB NOT NULL,                -- la fila completa tal cual estaba
  reason       TEXT,
  deleted_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deleted_appointments_log_appt_idx ON public.deleted_appointments_log (appointment_id);
CREATE INDEX IF NOT EXISTS deleted_appointments_log_date_idx ON public.deleted_appointments_log (deleted_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Solo lectura para dirección; las escrituras las hace el endpoint con service-role (salta RLS).
ALTER TABLE public.deleted_appointments_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deleted_appointments_log_select ON public.deleted_appointments_log;
CREATE POLICY deleted_appointments_log_select ON public.deleted_appointments_log FOR SELECT
  USING (is_admin_or_director());

-- SOURCE: scripts/migration-v46-commission-review.sql
-- v46 — Revisión de comisiones en planes personalizados.
-- En un plan de pago 'custom' (personalizado, varias cuotas negociadas a mano por el closer),
-- solo la reserva/entrada (el primer pago que adelanta el cliente) debe comisionar al instante.
-- Las cuotas siguientes, al cobrarlas, deben quedar en revisión manual de cobros en vez de generar
-- comisión real de inmediato (bug: la venta de un plan personalizado marcaba TODAS las cuotas como
-- comisionables el mismo día que se cobraban, sin control del equipo).
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS needs_commission_review BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.collections.needs_commission_review IS
  'TRUE = cobro de una cuota 2+ de un plan personalizado, pendiente de que cobros lo apruebe manualmente antes de generar comisión real. Mientras esté en TRUE, is_eligible_for_commission es FALSE y no hay filas en commissions para este cobro.';

CREATE INDEX IF NOT EXISTS collections_needs_review_idx
  ON public.collections (needs_commission_review)
  WHERE needs_commission_review = TRUE;

-- SOURCE: scripts/migration-v47-document-verification.sql
-- ============================================================
-- v47 — Verificación de documentos por país + cortafuegos para closer
--   (1) Tabla document_verifications: registro de documentos subidos
--   (2) Campos en sales para marcar estado y permitir override
--   (3) Índices y políticas de acceso
-- ============================================================

-- ---------- (1) Tabla de verificación de documentos ----------
CREATE TABLE IF NOT EXISTS public.document_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id),
  country_code TEXT,                    -- "US", "ES", "MX", etc.
  document_type TEXT,                   -- "passport", "dni", "driver_license", etc.
  document_url TEXT NOT NULL,           -- signed URL en bucket
  verified_at TIMESTAMPTZ,              -- cuándo se verificó (manual o automático)
  verified_by UUID REFERENCES public.users(id),  -- admin/director que verifica
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS document_verifications_updated_at ON public.document_verifications;
CREATE TRIGGER document_verifications_updated_at
  BEFORE UPDATE ON public.document_verifications
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX IF NOT EXISTS document_verifications_sale_idx ON public.document_verifications(sale_id);
CREATE INDEX IF NOT EXISTS document_verifications_contact_idx ON public.document_verifications(contact_id);
CREATE INDEX IF NOT EXISTS document_verifications_status_idx ON public.document_verifications(status);

ALTER TABLE public.document_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_verifications_select ON public.document_verifications;
CREATE POLICY document_verifications_select ON public.document_verifications
  FOR SELECT USING (get_my_role() IN ('admin','director','manager','csm'));
DROP POLICY IF EXISTS document_verifications_modify ON public.document_verifications;
CREATE POLICY document_verifications_modify ON public.document_verifications
  FOR ALL USING (get_my_role() IN ('admin','director')) WITH CHECK (get_my_role() IN ('admin','director'));

-- ---------- (2) Campos en sales para control de documentos ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_verified_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_verified_by UUID REFERENCES public.users(id);
-- Cortafuegos: permitir que closer/admin fuerce el envío sin verificación
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_verified_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_override_reason TEXT;  -- "contacto no responde", "problema técnico", etc.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_override_by UUID REFERENCES public.users(id);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS documents_override_at TIMESTAMPTZ;

-- ============================================================
-- FIN v47
-- ============================================================

-- SOURCE: scripts/migration-v48-appointment-tags.sql
-- ============================================================
-- MIGRACIÓN v48 — Etiquetas de agenda "Seguimiento" y "Reserva"
-- Idempotente.
-- ============================================================
-- Sugerencia del equipo: al etiquetar una agenda faltan las opciones
-- "seguimiento" y "reserva" (distintas del lead_status del contacto,
-- que ya las tenía desde antes). Se amplía el CHECK de appointments.status
-- siguiendo el mismo patrón que la migración v3.

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    'scheduled','confirmed','show','no_show','cancelled','rescheduled',
    'completed','cancelled_admin','cancelled_lead','seguimiento','reserva'
  ));

-- ============================================================
-- FIN v48
-- ============================================================

-- SOURCE: scripts/migration-v49-appointment-followup.sql
-- ============================================================
-- MIGRACIÓN v49 — Flag de seguimiento en agenda
-- Idempotente.
-- ============================================================
-- El status 'seguimiento' (v48) es excluyente con el resto de estados de la
-- cita. Para poder marcar "en seguimiento" una cita que además ya se presentó,
-- fue no-show, etc. sin perder ese estado real, se añade un flag independiente.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS needs_followup boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_appointments_needs_followup
  ON public.appointments (needs_followup)
  WHERE needs_followup = true;

-- ============================================================
-- FIN v49
-- ============================================================

-- SOURCE: scripts/migration-v50-sequra-morosos.sql
-- ============================================================
-- v50 — Morosos sequra (solo IA Winners)
--   Tabla de clientes con cuotas de sequra realmente vencidas (impago),
--   sincronizada periódicamente desde la API de sequra (ver
--   app/api/evergreen/cron/sequra-morosos). Solo merchant "iawinners";
--   The Closer Club tendrá su propia app/tabla equivalente más adelante.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sequra_delinquent_customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference    TEXT NOT NULL UNIQUE,       -- primary_reference del pedido en sequra
  merchant_reference TEXT NOT NULL DEFAULT 'iawinners'
    CHECK (merchant_reference = 'iawinners'),     -- solo IA Winners; garantía a nivel de BBDD
  customer_name      TEXT,
  customer_email     TEXT,
  product_name       TEXT,
  order_value        NUMERIC(12,2),               -- importe total del pedido
  debt_amount        NUMERIC(12,2),               -- importe vencido sin pagar
  overdue_days       INTEGER,
  overdue_since      DATE,
  status             TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'contactado', 'recuperado', 'incobrable')),
  notes              TEXT,
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS sequra_delinquent_customers_updated_at ON public.sequra_delinquent_customers;
CREATE TRIGGER sequra_delinquent_customers_updated_at
  BEFORE UPDATE ON public.sequra_delinquent_customers
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX IF NOT EXISTS sequra_delinquent_customers_status_idx
  ON public.sequra_delinquent_customers(status);

ALTER TABLE public.sequra_delinquent_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sequra_delinquent_customers_select ON public.sequra_delinquent_customers;
CREATE POLICY sequra_delinquent_customers_select ON public.sequra_delinquent_customers
  FOR SELECT USING (get_my_role() IN ('admin', 'director', 'manager', 'cobros'));

DROP POLICY IF EXISTS sequra_delinquent_customers_modify ON public.sequra_delinquent_customers;
CREATE POLICY sequra_delinquent_customers_modify ON public.sequra_delinquent_customers
  FOR ALL USING (get_my_role() IN ('admin', 'director', 'cobros'))
  WITH CHECK (get_my_role() IN ('admin', 'director', 'cobros'));

-- ============================================================
-- FIN v50
-- ============================================================

-- SOURCE: scripts/migration-v51-payment-follow-ups.sql
-- ============================================================
-- MIGRACIÓN v51 — Seguimiento (notas) en el pipeline de pagos
-- Idempotente.
-- ============================================================
-- Log de notas append-only por venta (llamadas, promesas de pago, acuerdos...),
-- visible en /evergreen/pagos y en el detalle de la venta. No sustituye a
-- sales.notes (que es un único campo editable): esto es un HISTORIAL con
-- autor y fecha, no se edita ni se borra una vez creado.

CREATE TABLE IF NOT EXISTS public.payment_follow_ups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_follow_ups_sale_id
  ON public.payment_follow_ups (sale_id, created_at DESC);

ALTER TABLE public.payment_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_follow_ups_select" ON public.payment_follow_ups;
CREATE POLICY "payment_follow_ups_select" ON public.payment_follow_ups
  FOR SELECT USING (get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS "payment_follow_ups_insert" ON public.payment_follow_ups;
CREATE POLICY "payment_follow_ups_insert" ON public.payment_follow_ups
  FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);

-- ============================================================
-- FIN v51
-- ============================================================

-- SOURCE: scripts/migration-v52-closer-calendly-email.sql
-- El email de login de un closer (users.email) puede ser distinto del email con el que
-- tiene configurada su cuenta de Calendly (ej: Jesus Peña usa un gmail personal para
-- entrar a la app pero jesus.p@iawinners.es en Calendly). El webhook y la creación manual
-- de agendas necesitan poder resolver el closer por ESE email también.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS calendly_email TEXT;

UPDATE public.users
SET calendly_email = 'jesus.p@iawinners.es'
WHERE id = 'f0f8bbee-70b1-4480-8e0d-515a661d7aae';

-- SOURCE: scripts/migration-v53-suggestions-kaizen.sql
-- v53 — Kaizen: reconocimiento y ranking de sugerencias del equipo
--   · Añade `resolved_at` a `suggestions` para poder medir "ideas implementadas
--     este mes" y construir un ranking/reconocimiento (mejora continua estilo
--     Kaizen) sin tocar ventas, pipeline ni métricas de negocio.
--   · Un trigger mantiene `resolved_at` automáticamente: se rellena la primera
--     vez que el status pasa a 'resuelta' y se limpia si se revierte el status
--     a cualquier otro valor (para que el ranking mensual sea siempre correcto).

ALTER TABLE public.suggestions
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Backfill: para las sugerencias que ya estaban 'resuelta' antes de esta
-- migración, usamos su updated_at como fecha de resolución aproximada.
UPDATE public.suggestions
   SET resolved_at = updated_at
 WHERE status = 'resuelta' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS suggestions_resolved_at_idx ON public.suggestions(resolved_at);

CREATE OR REPLACE FUNCTION public.suggestions_set_resolved_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'resuelta' AND (OLD.status IS DISTINCT FROM 'resuelta') THEN
    NEW.resolved_at := NOW();
  ELSIF NEW.status <> 'resuelta' AND OLD.status = 'resuelta' THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suggestions_resolved_at_trigger ON public.suggestions;
CREATE TRIGGER suggestions_resolved_at_trigger
  BEFORE UPDATE ON public.suggestions
  FOR EACH ROW EXECUTE FUNCTION public.suggestions_set_resolved_at();

-- Nota RLS: no se añade ninguna policy nueva. El ranking/estadísticas por
-- persona se sirven desde una API (/api/evergreen/suggestions/team-stats) que
-- usa la service role y devuelve solo agregados (nombre + contadores), nunca
-- el contenido de las sugerencias de otras personas, así que no hace falta
-- abrir el SELECT de la tabla a todo el equipo.

-- SOURCE: scripts/migration-v53-youtube-uploads.sql
-- Espejo automático de reels propios de Instagram hacia YouTube (Shorts).
-- youtube_uploads: registro append-only de qué media de ig_media ya se intentó subir a YouTube,
-- para no duplicar subidas en cada pasada del cron.
CREATE TABLE IF NOT EXISTS public.youtube_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_media_external_id TEXT NOT NULL UNIQUE REFERENCES public.ig_media(external_id) ON DELETE CASCADE,
  youtube_video_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marca de arranque de la función: solo se auto-suben a YouTube los reels publicados DESPUÉS de
-- activar esta función (evita subir de una vez todo el histórico de reels ya publicados en IG).
INSERT INTO public.app_settings (key, value)
VALUES ('youtube_sync_started_at', to_jsonb(now()))
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.youtube_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS youtube_uploads_select ON public.youtube_uploads;
CREATE POLICY youtube_uploads_select ON public.youtube_uploads FOR SELECT
  USING (get_my_role() IN ('admin','director','manager','marketing','editor'));
DROP POLICY IF EXISTS youtube_uploads_modify ON public.youtube_uploads;
CREATE POLICY youtube_uploads_modify ON public.youtube_uploads FOR ALL
  USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- SOURCE: scripts/migration-v54-youtube-stats.sql
-- Métricas del vídeo ya publicado en YouTube (para poder mostrarlas en la app junto a las de IG)
-- y soporte de backfill controlado (máx N subidas/día) de reels antiguos ya publicados en Instagram.
ALTER TABLE public.youtube_uploads
  ADD COLUMN IF NOT EXISTS views BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_synced_at TIMESTAMPTZ;

-- Backfill: encola TODOS los reels propios ya existentes en ig_media que aún no se hayan
-- intentado subir a YouTube, para que el cron los vaya publicando a razón de unos pocos al día
-- (ver YOUTUBE_BACKFILL_DAILY_LIMIT). No se tocan los que ya estén en la tabla (subidos o fallidos).
INSERT INTO public.youtube_uploads (ig_media_external_id, status)
SELECT m.external_id, 'pending'
FROM public.ig_media m
WHERE m.media_product_type = 'REELS'
  AND m.media_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.youtube_uploads u WHERE u.ig_media_external_id = m.external_id)
ON CONFLICT (ig_media_external_id) DO NOTHING;

-- SOURCE: scripts/migration-v55-calendly-cleanup-pending.sql
-- Si al reprogramar una agenda enlazada a Calendly falla la cancelación del evento antiguo
-- (rate limit / red, ver app/api/evergreen/appointments/reschedule/route.ts), el evento viejo
-- queda vivo en Calendly/Google Calendar y provoca un duplicado. Antes solo se logueaba en
-- consola; ahora se persiste para que un cron pueda reintentar la cancelación más tarde.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendly_cleanup_pending BOOLEAN DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendly_cleanup_event_uuid TEXT;

CREATE INDEX IF NOT EXISTS appointments_calendly_cleanup_pending_idx
  ON public.appointments(calendly_cleanup_pending) WHERE calendly_cleanup_pending = true;

-- SOURCE: scripts/migration-v56-course-access.sql
-- Control de accesos al curso desde la plataforma (los cursos viven en GHL/plataforma propia).
-- No sustituye a GHL como fuente de verdad del acceso real; registra CUÁNDO se concedió/revocó
-- desde aquí y dispara el mismo webhook saliente que ya usa el onboarding (lib/ghl.ts) para que
-- la automatización de GHL ejecute la acción real.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS course_access_granted_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS course_access_revoked_at TIMESTAMPTZ;

-- SOURCE: scripts/migration-v57-document-type.sql
-- ============================================================
-- v57 — Tipo y número de documento del alumno (sin foto)
--   Sustituye el flujo de "excepción con motivo" por un registro directo:
--   el closer elige tipo de documento (DNI/Pasaporte/NIE/Otro) y escribe
--   el número. DNI/NIE se validan por checksum; Pasaporte y Otro pasan
--   sin validación de formato (Otro es el cortafuegos: siempre pasa).
-- ============================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS student_document_type TEXT
  CHECK (student_document_type IN ('dni', 'pasaporte', 'nie', 'otro'));
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS student_document_number TEXT;

-- ============================================================
-- FIN v57
-- ============================================================

-- SOURCE: scripts/migration-v58-followup-pipeline.sql
-- Pipeline interno de seguimiento comercial para agendas que necesitan trabajo manual del equipo:
-- no-show a recontactar, asistió pero está negociando el pago, o quedó pendiente de una nueva
-- fecha reagendada. `followup_stage` es INDEPENDIENTE de `status` (que refleja el resultado real
-- de la cita: show/no_show/cancelled/etc) y también de `pipeline_stage` (texto libre que rellenan
-- las integraciones externas como GHL/Calendly) — no confundir ninguno de los dos con esta columna,
-- que es de uso exclusivo del equipo de ventas desde la app para triage manual.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS followup_stage TEXT
    CHECK (followup_stage IN ('pendiente_recontacto','en_seguimiento_pago','reagendado_pendiente','cerrado')),
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointments_followup_stage
  ON public.appointments(followup_stage) WHERE followup_stage IS NOT NULL;

-- SOURCE: scripts/migration-v59-followup-descualificado.sql
-- Añade la etapa "descualificado" al pipeline de seguimiento (migration-v58): leads que no se
-- vuelven a trabajar porque el lead no era válido (teléfono falso, datos inventados, etc), a
-- diferencia de "cerrado" (que implica venta/cierre real). El motivo se guarda en `notes` de la
-- agenda (columna ya existente, visible en la columna "Notas" del pipeline de seguimiento).
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_followup_stage_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_followup_stage_check
    CHECK (followup_stage IN ('pendiente_recontacto','en_seguimiento_pago','reagendado_pendiente','cerrado','descualificado'));

-- SOURCE: scripts/migration-v60-content-editor-insert.sql
-- v60 — Permite a los editores crear piezas de contenido nuevas.
-- Bug: la política content_modify (v39) solo permitía INSERT/UPDATE/DELETE a
-- admin/director/marketing, así que cuando un editor pulsaba "nueva pieza" en
-- /evergreen/content, Supabase rechazaba el insert por RLS y la fila nunca
-- llegaba a la tabla (sin error visible más allá de un toast).
-- El editor solo puede crearse piezas A SÍ MISMO asignadas (mismo criterio que
-- ya usa content_editor_update para editar), para no darle vía libre a asignar
-- piezas a otras personas.

DROP POLICY IF EXISTS content_editor_insert ON public.content_items;
CREATE POLICY content_editor_insert ON public.content_items FOR INSERT
  WITH CHECK (get_my_role() = 'editor' AND assigned_to = auth.uid());

-- SOURCE: scripts/migration-v61-reschedule-prior-status.sql
-- v61 — Guarda si una agenda reagendada venía de un No show o de un Show.
-- Bug: /appointments/reschedule sobreescribe la MISMA fila y resetea status a
-- 'scheduled', así que se perdía si la cita reagendada era porque el lead no
-- se presentó (no_show) o porque sí se presentó y se agenda una siguiente
-- llamada (show). Solo quedaba una nota de texto genérica en `activities`.
-- `rescheduled_from_status` guarda el status justo antes de esa reprogramación,
-- para poder distinguir "Reagenda / No show" de "Reagenda / Show" en el
-- historial de citas del contacto.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS rescheduled_from_status TEXT;

-- SOURCE: scripts/migration-v62-positive-notes.sql
-- v62 — Positivo del día/semana: nota de energía personal, con opción de compartirla
-- en el muro del equipo. Privada por defecto; el usuario decide si la hace visible.
--   · period_key: 'YYYY-MM-DD' para diarias, 'YYYY-Www' (ISO week) para semanales.
--   · una fila por usuario+periodo (upsert): al reescribir la nota del mismo día/semana
--     se actualiza en vez de duplicar.

CREATE TABLE IF NOT EXISTS public.positive_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly')),
  period_key  TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_shared   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS positive_notes_wall_idx
  ON public.positive_notes (is_shared, created_at DESC)
  WHERE is_shared = true;

CREATE OR REPLACE FUNCTION public.positive_notes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS positive_notes_updated_at_trigger ON public.positive_notes;
CREATE TRIGGER positive_notes_updated_at_trigger
  BEFORE UPDATE ON public.positive_notes
  FOR EACH ROW EXECUTE FUNCTION public.positive_notes_set_updated_at();

-- Nota RLS: igual que `suggestions`, no se abre policy nueva — todo el acceso pasa por
-- /api/evergreen/positive-notes con la service role, que filtra: cada uno solo ve/edita
-- su propia nota, y el muro del equipo solo expone las marcadas is_shared = true.

-- SOURCE: scripts/migration-v63-users-select-team.sql
-- v63: la política "users_select" solo permitía ver la propia fila (o todas si eras
-- admin/director). Cualquier setter/closer/etc. que no fuera admin/director no podía ver
-- a sus compañeros, así que los selectores de closer/setter/afiliado al marcar una venta
-- (app/evergreen/sales/[id], sales/page.tsx, sales/new/page.tsx) le salían casi vacíos
-- (bug reportado: "No sale Jesús Peña al elegir closer"). Se amplía igual que ya está
-- resuelto para `contacts_select_team`: cualquier usuario con rol válido puede ver el
-- listado básico del equipo.
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users FOR SELECT USING (
  is_admin_or_director() OR id = auth.uid() OR get_my_role() IS NOT NULL
);

-- SOURCE: scripts/migration-v64-content-order-price.sql
-- Sugerencia de equipo (content/reels): reordenar manualmente la lista y añadir precio por pieza
-- con suma mensual, para llevar el pago a editores por pieza editada.
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS price NUMERIC(10,2);

-- Rellena sort_order inicial según el orden actual (más antiguo = 1) para que el modo "Manual"
-- arranque igual que "Añadido: antiguo primero" en vez de en blanco.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.content_items
  WHERE sort_order IS NULL
)
UPDATE public.content_items c
SET sort_order = ranked.rn
FROM ranked
WHERE c.id = ranked.id;

-- SOURCE: migrations/2026-07-08-vsl.sql
-- ============================================================
-- VSL tracking (IA WINNERS) — vturb-style, in-house
-- ============================================================

create table if not exists vsl_videos (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  name             text not null,
  source_url       text,                       -- .mp4 (Vercel Blob) o .m3u8 (Bunny/HLS)
  poster_url       text,                        -- miniatura mostrada al instante
  duration_seconds numeric not null default 0,
  config           jsonb  not null default '{}'::jsonb,  -- {barColor, primaryColor, autoplay, muted, lockSeek, showBar}
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- una fila por sesión de visionado (anónima; se puede identificar con email del form)
create table if not exists vsl_sessions (
  id            uuid primary key default gen_random_uuid(),
  video_id      uuid not null references vsl_videos(id) on delete cascade,
  anon_id       text not null,
  lead_email    text,
  lead_name     text,
  referrer      text,
  device        text,                     -- mobile | desktop | tablet
  country       text,
  user_agent    text,
  duration      numeric not null default 0,   -- duración conocida del vídeo en esta sesión
  max_position  numeric not null default 0,   -- segundo máximo alcanzado
  watched_seconds int[] not null default '{}',-- segundos enteros únicos vistos (heatmap real)
  plays         int  not null default 0,
  reached_end   boolean not null default false,
  first_play_at timestamptz,
  last_beat_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (video_id, anon_id)
);

create index if not exists idx_vsl_sessions_video on vsl_sessions(video_id);
create index if not exists idx_vsl_sessions_email on vsl_sessions(lead_email) where lead_email is not null;
create index if not exists idx_vsl_sessions_created on vsl_sessions(created_at);
