-- Storage privado y aislado por subcuenta.
--
-- Antes, /api/[tenant]/evergreen/admin/setup forzaba los buckets `contratos` y `facturas` a
-- públicos (creándolos públicos, o volviendo público uno que ya fuera privado). Contratos firmados
-- y facturas llevan nombre, DNI, firma y datos fiscales: con el bucket público bastaba conocer la
-- URL para descargarlos, sin sesión. Esa ruta se ha eliminado del código; esta migración fija el
-- estado correcto en la base y añade las políticas que faltaban.
--
-- Convención de rutas: todo objeto va bajo `"<tenant_id>/..."`. El primer segmento de la ruta es lo
-- que permite validar pertenencia sin tener que consultar la tabla de negocio dueña del fichero.

-- 1) Buckets privados e idempotentes. `contratos` ya existe y es privado en producción; `facturas`
--    todavía no existía, así que se crea aquí en vez de dejar que lo cree una ruta HTTP.
INSERT INTO storage.buckets (id, name, public)
VALUES ('contratos', 'contratos', false), ('facturas', 'facturas', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2) Políticas por pertenencia a la subcuenta, derivada del primer segmento de la ruta.
--    storage.foldername(name) devuelve los segmentos del path; [1] es el tenant_id.
DROP POLICY IF EXISTS "tenant_files_select" ON storage.objects;
DROP POLICY IF EXISTS "tenant_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "tenant_files_update" ON storage.objects;
DROP POLICY IF EXISTS "tenant_files_delete" ON storage.objects;

CREATE POLICY "tenant_files_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('contratos', 'facturas')
    AND (
      (storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text)
      OR public.is_super_admin()
    )
  );

CREATE POLICY "tenant_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('contratos', 'facturas')
    AND (
      (storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text)
      OR public.is_super_admin()
    )
  );

CREATE POLICY "tenant_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('contratos', 'facturas')
    AND (
      (storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text)
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    bucket_id IN ('contratos', 'facturas')
    AND (
      (storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text)
      OR public.is_super_admin()
    )
  );

CREATE POLICY "tenant_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('contratos', 'facturas')
    AND (
      (storage.foldername(name))[1] IN (SELECT public.auth_tenant_ids()::text)
      OR public.is_super_admin()
    )
  );

-- Nota sobre los PDF de contratos firmados: los escribe el service role desde las rutas públicas de
-- firma (/api/public-contracts/sign*), que no tienen sesión porque quien firma es alguien externo.
-- El service role salta RLS, así que esas escrituras siguen funcionando; la lectura desde la app va
-- por signed URL de vida corta emitida en servidor, nunca por URL pública.
