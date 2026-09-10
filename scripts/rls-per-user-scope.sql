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
