-- V1 del módulo VSL: soft delete de vídeos.
-- El DELETE físico borraba la fila y con ella el histórico de sesiones de los joins.
-- Con deleted_at, un vídeo eliminado deja de listarse/servirse pero sus sesiones
-- (retención, leads, % del contacto) siguen siendo legibles para analytics.
ALTER TABLE public.vsl_videos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- El listado y el lookup público filtran deleted_at IS NULL (ver código de rutas).
CREATE INDEX IF NOT EXISTS vsl_videos_tenant_alive_idx
  ON public.vsl_videos (tenant_id) WHERE deleted_at IS NULL;

-- El upsert de sesión y el embed públicos solo deben resolver vídeos vivos.
CREATE INDEX IF NOT EXISTS vsl_videos_slug_alive_idx
  ON public.vsl_videos (slug) WHERE deleted_at IS NULL;
