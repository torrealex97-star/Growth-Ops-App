-- Banco de grabaciones de llamadas.
--
-- Decisiones y por qué:
--
-- * `sha256` con único POR SUBCUENTA. Es el dedupe: subir dos veces el mismo archivo no crea dos
--   filas, y una subida masiva interrumpida se puede reintentar sin miedo a duplicar lo ya subido.
--   Por subcuenta y no global, porque dos clientes distintos pueden tener legítimamente el mismo
--   archivo y una no debe ver un choque con la otra (el error que acabamos de corregir en slug).
-- * `category` se deriva del MIME en la aplicación (lib/recordings/categorize.ts), NO de la IA, y se
--   guarda para poder filtrar sin recalcular. El CHECK impide que entre una categoría inventada.
-- * `status` con aprobación MANUAL. Una grabación recién subida no se usa: alguien la revisa. Es
--   material con voz de clientes reales y consentimiento por medio.
-- * `storage_path` empieza por `<tenant_id>/` — misma convención que las políticas de Storage ya
--   aplicadas, que validan la pertenencia por el primer segmento de la ruta.
-- * NO se guarda la transcripción aquí: eso vive en appointments.transcript, atado a la cita. Este
--   banco guarda el ARCHIVO y su procedencia.

CREATE TABLE public.call_recordings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id),
  -- Ruta dentro del bucket privado, siempre bajo '<tenant_id>/'.
  storage_path   TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL CHECK (size_bytes > 0),
  -- Hash del contenido en hexadecimal (64 caracteres). Es la identidad real del archivo.
  sha256         TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  category       TEXT NOT NULL CHECK (category IN ('audio', 'video', 'transcripcion', 'documento')),
  status         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (status IN ('pendiente', 'aprobada', 'rechazada')),
  -- Cita a la que pertenece, si se conoce. Opcional a propósito: se puede subir un lote primero y
  -- atarlo después, y forzarlo obligaría a adivinar — el mismo error del matching de Fathom.
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  notes          TEXT,
  uploaded_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una grabación revisada tiene que decir quién y cuándo; una pendiente, no puede decirlo.
  CONSTRAINT call_recordings_review_coherent CHECK (
    (status = 'pendiente' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status <> 'pendiente' AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX call_recordings_tenant_sha_key ON public.call_recordings(tenant_id, sha256);
CREATE INDEX call_recordings_tenant_created_idx ON public.call_recordings(tenant_id, created_at DESC);
CREATE INDEX call_recordings_pendientes_idx ON public.call_recordings(tenant_id, created_at DESC)
  WHERE status = 'pendiente';
CREATE INDEX call_recordings_appointment_idx ON public.call_recordings(appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE TRIGGER call_recordings_updated_at
  BEFORE UPDATE ON public.call_recordings
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;

-- Subir y aprobar son decisiones sobre material sensible: admin/director. El equipo con sesión
-- puede consultarlo (es material de formación de ventas).
CREATE POLICY "call_recordings_admin_write" ON public.call_recordings FOR ALL
  USING (is_admin_or_director())
  WITH CHECK (is_admin_or_director());
CREATE POLICY "call_recordings_select_team" ON public.call_recordings FOR SELECT
  USING (get_my_role() IS NOT NULL);

CREATE POLICY "call_recordings_tenant_isolation" ON public.call_recordings AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

-- Bucket privado propio. Las políticas de storage.objects ya aplicadas cubren 'contratos' y
-- 'facturas' por nombre, así que este bucket necesita su propia política con la misma convención.
INSERT INTO storage.buckets (id, name, public)
VALUES ('grabaciones', 'grabaciones', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "grabaciones_tenant_select" ON storage.objects;
DROP POLICY IF EXISTS "grabaciones_tenant_insert" ON storage.objects;
DROP POLICY IF EXISTS "grabaciones_tenant_delete" ON storage.objects;

CREATE POLICY "grabaciones_tenant_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'grabaciones'
    AND ((storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text) OR public.is_super_admin())
  );
CREATE POLICY "grabaciones_tenant_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'grabaciones'
    AND ((storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text) OR public.is_super_admin())
  );
CREATE POLICY "grabaciones_tenant_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'grabaciones'
    AND ((storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text) OR public.is_super_admin())
  );
