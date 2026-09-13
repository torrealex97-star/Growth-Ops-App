-- ─────────────────────────────────────────────────────────────────────────────
-- HISTORIAL DE EJECUCIONES DE SINCRONIZACIÓN (integration_sync_runs)
--
-- POR QUÉ EXISTE. El panel de Integraciones decía literalmente "Credenciales y planificador
-- correctos, pero campaigns está vacía. Revisa el último error del sync" — y ese último error no
-- se guardaba en ninguna parte. Las syncs de Meta, además, se tragaban los errores de escritura
-- fila a fila (`if (error) continue`) y devolvían `ok: true, synced: 0`: un fallo total parecía
-- un éxito sin datos. Sin esta tabla no hay forma de distinguir los estados que el usuario
-- necesita distinguir: nunca se ha ejecutado / falló / terminó bien sin traer nada / los datos
-- son viejos.
--
-- Además sirve de CERROJO: el índice único parcial sobre (tenant_id, job) para status='running'
-- impide que dos ejecuciones de la misma sincronización corran a la vez (cron + botón manual),
-- que es como se duplican filas y se agotan los rate limits del proveedor.
--
-- Escribe siempre el servidor con service-role; el equipo solo LEE. `error_message` se guarda ya
-- redactado (lib/integrations/sync-runs.ts) para que ninguna credencial acabe aquí.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.integration_sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,                       -- 'meta' | 'stripe' | 'instagram' | …
  job           TEXT NOT NULL,                       -- id de SYNC_DEFS: 'meta', 'meta-daily', 'meta-ads', …
  status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error', 'timeout')),
  trigger       TEXT NOT NULL CHECK (trigger IN ('cron', 'manual', 'historico')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  rows_written  INTEGER,                             -- NULL = no se sabe; 0 es un dato, no un hueco
  error_code    TEXT,                                -- código estable (lib/meta/errors.ts), no texto libre
  error_message TEXT,                                -- ya redactado: nunca una credencial
  detail        JSONB,                               -- resumen de la ejecución (cuentas, rango, fallos parciales)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_sync_runs_tenant_job_idx
  ON public.integration_sync_runs (tenant_id, job, started_at DESC);
CREATE INDEX IF NOT EXISTS integration_sync_runs_tenant_idx
  ON public.integration_sync_runs (tenant_id);

-- Cerrojo de concurrencia: como máximo UNA ejecución en curso por (subcuenta, sincronización).
CREATE UNIQUE INDEX IF NOT EXISTS integration_sync_runs_one_running_idx
  ON public.integration_sync_runs (tenant_id, job)
  WHERE status = 'running';

ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro del equipo de la subcuenta (es diagnóstico, no datos sensibles).
DROP POLICY IF EXISTS integration_sync_runs_select ON public.integration_sync_runs;
CREATE POLICY integration_sync_runs_select ON public.integration_sync_runs
  FOR SELECT USING (public.get_my_role() IS NOT NULL);

-- INSERT/UPDATE/DELETE: solo admin/director. Las syncs escriben con service-role (salta RLS), así
-- que esto no es el camino normal de escritura: es el límite para cualquier cliente con sesión.
DROP POLICY IF EXISTS integration_sync_runs_modify ON public.integration_sync_runs;
CREATE POLICY integration_sync_runs_modify ON public.integration_sync_runs
  FOR ALL USING (public.is_admin_or_director()) WITH CHECK (public.is_admin_or_director());

-- Aislamiento por subcuenta, igual que el resto de tablas de negocio.
DROP POLICY IF EXISTS integration_sync_runs_tenant_isolation ON public.integration_sync_runs;
CREATE POLICY integration_sync_runs_tenant_isolation ON public.integration_sync_runs
  AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
