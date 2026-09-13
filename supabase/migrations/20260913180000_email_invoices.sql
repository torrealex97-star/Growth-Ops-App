-- Buzón de facturas recibidas por email (Gmail).
--
-- DOS CLAVES DE DEDUPE, porque protegen de cosas distintas:
--
--  * (tenant_id, provider, message_id, attachment_id) — la MISMA ocurrencia. Es lo que hace que el
--    sync se pueda repetir: volver a recorrer el buzón no vuelve a importar lo ya importado.
--  * (tenant_id, sha256) — el MISMO CONTENIDO llegado por caminos distintos. El caso real: el
--    proveedor manda la factura, y el gestor la reenvía. Son dos mensajes y dos adjuntos, pero una
--    sola factura, y contarla dos veces en contabilidad sería un error de dinero.
--
-- Ambas por subcuenta, nunca globales.
--
-- NADA ENTRA EN CONTABILIDAD SOLO. El estado inicial es 'pendiente_validacion' y `expense_id` nace
-- NULL: una factura importada es material a revisar, no un gasto registrado. Que un correo
-- automático cree un asiento contable sin que nadie lo mire es exactamente lo que no se quiere.

CREATE TABLE public.email_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id),
  provider       TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
  message_id     TEXT NOT NULL,
  attachment_id  TEXT NOT NULL,
  sha256         TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Metadatos del correo, para que una persona reconozca la factura sin abrir el archivo.
  from_email     TEXT,
  subject        TEXT,
  received_at    TIMESTAMPTZ,
  file_name      TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL CHECK (size_bytes > 0),
  storage_path   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendiente_validacion'
                   CHECK (status IN ('pendiente_validacion', 'validada', 'descartada')),
  -- Gasto al que se vinculó AL VALIDARLA. Nunca se rellena automáticamente.
  expense_id     UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  notes          TEXT,
  validated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  validated_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una factura validada tiene que decir quién y cuándo; una pendiente no puede decirlo, ni tener
  -- un gasto vinculado.
  CONSTRAINT email_invoices_validation_coherent CHECK (
    (status = 'pendiente_validacion' AND validated_at IS NULL AND validated_by IS NULL AND expense_id IS NULL)
    OR (status <> 'pendiente_validacion' AND validated_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX email_invoices_occurrence_key
  ON public.email_invoices(tenant_id, provider, message_id, attachment_id);
CREATE UNIQUE INDEX email_invoices_content_key
  ON public.email_invoices(tenant_id, sha256);
CREATE INDEX email_invoices_pendientes_idx
  ON public.email_invoices(tenant_id, received_at DESC)
  WHERE status = 'pendiente_validacion';

CREATE TRIGGER email_invoices_updated_at
  BEFORE UPDATE ON public.email_invoices
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.email_invoices ENABLE ROW LEVEL SECURITY;

-- Datos fiscales: admin/director gestionan, y gestoría los lee (es su trabajo).
CREATE POLICY "email_invoices_admin_write" ON public.email_invoices FOR ALL
  USING (is_admin_or_director())
  WITH CHECK (is_admin_or_director());
CREATE POLICY "email_invoices_select_finance" ON public.email_invoices FOR SELECT
  USING (get_my_role() IN ('admin', 'director', 'manager', 'gestoria', 'cobros'));

CREATE POLICY "email_invoices_tenant_isolation" ON public.email_invoices AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
