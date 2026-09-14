-- Fase EXPAND del cambio de RPC: crea una firma con nombre único para la subcuenta activa.
-- La función anterior sigue disponible mientras conviven el frontend antiguo y el nuevo.
CREATE OR REPLACE FUNCTION public.attribution_funnel_for_tenant(p_tenant_id UUID)
RETURNS TABLE(source TEXT, leads BIGINT, appointments BIGINT, sales BIGINT, gross NUMERIC)
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH authorized_tenant AS (
    SELECT p_tenant_id AS tenant_id
    WHERE p_tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin()
  ),
  primary_attr AS (
    SELECT ca.contact_id,
           COALESCE(NULLIF(ca.source,''), NULLIF(ca.utm_source,''), 'Directo / Sin atribuir') AS src
    FROM public.contact_attributions ca
    JOIN authorized_tenant t ON t.tenant_id = ca.tenant_id
    WHERE ca.is_primary = TRUE
  ),
  contact_src AS (
    SELECT c.id AS contact_id, COALESCE(pa.src, 'Directo / Sin atribuir') AS src
    FROM public.contacts c
    JOIN authorized_tenant t ON t.tenant_id = c.tenant_id
    LEFT JOIN primary_attr pa ON pa.contact_id = c.id
  ),
  l AS (SELECT src, COUNT(*) AS leads FROM contact_src GROUP BY src),
  ap AS (
    SELECT cs.src, COUNT(*) AS appointments
    FROM contact_src cs
    JOIN public.appointments a ON a.contact_id = cs.contact_id AND a.tenant_id = p_tenant_id
    GROUP BY cs.src
  ),
  sl AS (
    SELECT cs.src, COUNT(*) AS sales, SUM(s.gross_amount) AS gross
    FROM contact_src cs
    JOIN public.sales s ON s.contact_id = cs.contact_id AND s.tenant_id = p_tenant_id
    WHERE s.status IN ('active','partial_refund')
    GROUP BY cs.src
  )
  SELECT l.src, l.leads, COALESCE(ap.appointments,0), COALESCE(sl.sales,0), COALESCE(sl.gross,0)
  FROM l LEFT JOIN ap USING (src) LEFT JOIN sl USING (src)
  ORDER BY 5 DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.attribution_funnel_for_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attribution_funnel_for_tenant(UUID) TO authenticated;
