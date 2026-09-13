-- Los slugs deben ser únicos POR SUBCUENTA, no globalmente.
--
-- EL FALLO. testimonios, qualification_questions y vsl_videos tienen tenant_id, pero su índice
-- único era sobre (slug) a secas — herencia de cuando la app era de una sola cuenta. Consecuencias:
--   - La segunda subcuenta que usara el slug "xavi" (o "principal" en un vídeo VSL) recibía un error
--     de clave duplicada causado por una fila de OTRA subcuenta que ni puede ver por RLS. Un error
--     imposible de entender desde la propia subcuenta.
--   - Bloquea el aprovisionamiento de subcuentas nuevas: cada una chocaría en los slugs naturales.
-- Es la misma clase de fallo que ya se corrigió en integration_settings
-- (20260911160000_fix_cron_unique_constraints), que se quedó sin revisar en estas tres tablas.
--
-- Seguro de aplicar: VERIFICADO que las tres tablas están vacías en producción (0 filas), así que
-- no hay ningún dato que migrar ni ninguna colisión que resolver.

ALTER TABLE public.testimonios DROP CONSTRAINT IF EXISTS testimonios_slug_key;
DROP INDEX IF EXISTS public.testimonios_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS testimonios_tenant_slug_key
  ON public.testimonios(tenant_id, slug);

ALTER TABLE public.qualification_questions DROP CONSTRAINT IF EXISTS qualification_questions_slug_key;
DROP INDEX IF EXISTS public.qualification_questions_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS qualification_questions_tenant_slug_key
  ON public.qualification_questions(tenant_id, slug);

ALTER TABLE public.vsl_videos DROP CONSTRAINT IF EXISTS vsl_videos_slug_key;
DROP INDEX IF EXISTS public.vsl_videos_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS vsl_videos_tenant_slug_key
  ON public.vsl_videos(tenant_id, slug);
