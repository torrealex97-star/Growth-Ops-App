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
