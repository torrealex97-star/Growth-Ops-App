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
  name            TEXT NOT NULL DEFAULT 'Academia Demo',
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
VALUES (1, '[tenant]', '[tenant]', 'B-00000000')
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
