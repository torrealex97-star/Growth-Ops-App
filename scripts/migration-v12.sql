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
