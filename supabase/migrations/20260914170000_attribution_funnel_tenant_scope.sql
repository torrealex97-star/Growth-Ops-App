-- P0 DE AISLAMIENTO: `attribution_funnel()` mezclaba los datos de TODAS las subcuentas.
--
-- QUÉ PASABA. La función es SECURITY DEFINER —así que salta la RLS— y no filtraba por `tenant_id` en
-- ninguna de sus cuatro tablas (contact_attributions, contacts, appointments, sales). Está concedida
-- a `authenticated` y es accesible por `/rest/v1/rpc/attribution_funnel`, así que cualquier usuario
-- de cualquier subcuenta podía pedirla y recibir leads, agendas, ventas y FACTURACIÓN agregada de las
-- demás. Con dos subcuentas activas, un usuario de Women Digital Closer veía el dinero de Evergreen y
-- al revés.
--
-- CÓMO SE COLÓ. Se revocó de `anon` en 20260911130000_fix_rls_p0_round2, cuando la app todavía no era
-- multi-tenant. La migración que introdujo las subcuentas (20260911140000) es POSTERIOR y no volvió
-- sobre esta función: el mismo olvido que dejó las comisiones sin `tenant_id`.
--
-- EL ARREGLO. Dos capas, a propósito:
--  1. SECURITY INVOKER: la RLS de cada tabla vuelve a aplicar, que es quien sabe de verdad qué puede
--     ver cada usuario. No hay que reimplementar esa lógica aquí ni mantenerla sincronizada.
--  2. Filtro explícito por `auth_tenant_ids()` en las cuatro tablas. Con INVOKER es redundante, y por
--     eso mismo es la red: si alguien vuelve a marcarla DEFINER por descuido, el filtro sigue ahí.
--     Es una función que devuelve dinero; no se deja colgando de una sola capa.
-- LIMITACIÓN CONOCIDA, no un descuido: la función no recibe la subcuenta como parámetro (la pantalla
-- la llama sin argumentos), así que devuelve lo de TODAS las subcuentas del usuario. Para un usuario
-- normal, que pertenece a una, es exacto. Un super_admin con varias verá las suyas sumadas en vez de
-- solo la de la URL. Arreglarlo del todo es añadir `p_tenant_id` y pasarlo desde
-- app/[tenant]/marketing/adquisicion/atribucion/page.tsx — cambio de API, su propio paso. Lo que YA
-- no ocurre es lo grave: ver las subcuentas a las que no perteneces.
CREATE OR REPLACE FUNCTION public.attribution_funnel()
 RETURNS TABLE(source text, leads bigint, appointments bigint, sales bigint, gross numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH primary_attr AS (
    SELECT ca.contact_id,
           COALESCE(NULLIF(ca.source,''), NULLIF(ca.utm_source,''), 'Directo / Sin atribuir') AS src
    FROM public.contact_attributions ca
    WHERE ca.is_primary = TRUE
      AND ca.tenant_id IN (SELECT public.auth_tenant_ids())
  ),
  contact_src AS (
    SELECT c.id AS contact_id, COALESCE(pa.src, 'Directo / Sin atribuir') AS src
    FROM public.contacts c
    LEFT JOIN primary_attr pa ON pa.contact_id = c.id
    WHERE c.tenant_id IN (SELECT public.auth_tenant_ids())
  ),
  l AS (SELECT src, COUNT(*) AS leads FROM contact_src GROUP BY src),
  ap AS (
    SELECT cs.src, COUNT(*) AS appointments
    FROM contact_src cs
    JOIN public.appointments a ON a.contact_id = cs.contact_id
     AND a.tenant_id IN (SELECT public.auth_tenant_ids())
    GROUP BY cs.src
  ),
  sl AS (
    SELECT cs.src, COUNT(*) AS sales, SUM(s.gross_amount) AS gross
    FROM contact_src cs
    JOIN public.sales s ON s.contact_id = cs.contact_id
     AND s.tenant_id IN (SELECT public.auth_tenant_ids())
    WHERE s.status IN ('active','partial_refund')
    GROUP BY cs.src
  )
  SELECT l.src, l.leads, COALESCE(ap.appointments,0), COALESCE(sl.sales,0), COALESCE(sl.gross,0)
  FROM l LEFT JOIN ap USING (src) LEFT JOIN sl USING (src)
  ORDER BY 5 DESC NULLS LAST;
$function$;

-- `anon` sigue fuera: esto son datos de negocio, no una página pública.
REVOKE ALL ON FUNCTION public.attribution_funnel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attribution_funnel() TO authenticated;

-- De paso, el otro aviso del linter de Supabase: `merge_contacts` tenía el search_path mutable. En
-- una función que REPUNTA filas de una tabla a otra, un search_path que dependa de quien la llama es
-- una puerta a que resuelva nombres distintos de los previstos.
ALTER FUNCTION public.merge_contacts(UUID, UUID, UUID) SET search_path TO 'public';
