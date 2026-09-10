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
