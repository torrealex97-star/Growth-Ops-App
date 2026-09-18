-- 20260918060000 — Añade `is_monitoring` a `sale_expected_installments`.
--
-- POR QUÉ. La feature v11 (cuota de monitorización: el alumno paga a la financiera, p.ej. Sequra;
-- NO es cash nuestro) escribe esta columna en ~7 sitios del código (registro de ventas, pagos,
-- morosidad, comisiones futuras, types). La migración que la crea no está en el repo y nunca se
-- aplicó a producción: PostgREST responde 400 `column sale_expected_installments.is_monitoring
-- does not exist` y el INSERT de cuotas en ventas/registro/nueva falla EN SILENCIO, dejando
-- ventas de financiación sin sus cuotas (la tabla llegó a estar vacía).
--
-- DEFAULT FALSE: las filas existentes (si las hubiera) son cash nuestro — semántica correcta.
-- Idempotente para poder re-ejecutarla sin daño.

ALTER TABLE public.sale_expected_installments
  ADD COLUMN IF NOT EXISTS is_monitoring BOOLEAN NOT NULL DEFAULT FALSE;

-- Comentario de columna para que la semántica viaje con la BD.
COMMENT ON COLUMN public.sale_expected_installments.is_monitoring IS
  'v11: cuota del alumno con la financiera (Sequra). TRUE = no es cash nuestro, solo control de impago.';
