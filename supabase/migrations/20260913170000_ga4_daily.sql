-- Datos diarios de GA4, desglosados por las dimensiones que sirven para atribuir tráfico.
--
-- Decisiones:
--
-- * Una fila por (fecha × fuente × medio × campaña × landing × dispositivo). La clave única cubre
--   TODAS esas columnas, no solo la fecha: es lo que hace que el sync pueda repetirse sin duplicar.
--   GA4 puede reprocesar sus propios datos durante 48 h, así que volver a pedir los últimos días es
--   lo normal, no una excepción — y sin esta clave cada pasada duplicaría el histórico.
-- * Las dimensiones son NOT NULL con DEFAULT '': GA4 devuelve '(not set)' o cadena vacía cuando no
--   hay valor, y si se guardaran como NULL la clave única dejaría de funcionar (en Postgres, NULL no
--   es igual a NULL, así que dos filas con la misma landing y campaña nula NO chocarían y entrarían
--   las dos). Este detalle es exactamente el tipo de cosa que produce histórico duplicado meses
--   después sin que nadie entienda por qué.
-- * `synced_at` para poder decir en pantalla de cuándo son los datos, y distinguir "cero sesiones"
--   de "no se ha sincronizado todavía".

CREATE TABLE public.ga4_daily (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  date          DATE NOT NULL,
  source        TEXT NOT NULL DEFAULT '',
  medium        TEXT NOT NULL DEFAULT '',
  campaign      TEXT NOT NULL DEFAULT '',
  landing_page  TEXT NOT NULL DEFAULT '',
  device        TEXT NOT NULL DEFAULT '',
  sessions      INTEGER NOT NULL DEFAULT 0 CHECK (sessions >= 0),
  active_users  INTEGER NOT NULL DEFAULT 0 CHECK (active_users >= 0),
  new_users     INTEGER NOT NULL DEFAULT 0 CHECK (new_users >= 0),
  conversions   NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  engaged_sessions INTEGER NOT NULL DEFAULT 0 CHECK (engaged_sessions >= 0),
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ga4_daily_grain_key
  ON public.ga4_daily(tenant_id, date, source, medium, campaign, landing_page, device);

-- El acceso real es "dame el rango de fechas de esta subcuenta".
CREATE INDEX ga4_daily_tenant_date_idx ON public.ga4_daily(tenant_id, date DESC);

CREATE TRIGGER ga4_daily_updated_at
  BEFORE UPDATE ON public.ga4_daily
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.ga4_daily ENABLE ROW LEVEL SECURITY;

-- Métrica de negocio: la escribe el sync (service role) y la lee el equipo con sesión.
CREATE POLICY "ga4_daily_admin_write" ON public.ga4_daily FOR ALL
  USING (is_admin_or_director())
  WITH CHECK (is_admin_or_director());
CREATE POLICY "ga4_daily_select_team" ON public.ga4_daily FOR SELECT
  USING (get_my_role() IS NOT NULL);

CREATE POLICY "ga4_daily_tenant_isolation" ON public.ga4_daily AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
