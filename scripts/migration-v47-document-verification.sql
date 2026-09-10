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
