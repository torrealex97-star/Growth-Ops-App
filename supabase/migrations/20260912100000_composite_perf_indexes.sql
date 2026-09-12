-- Fase 8 (rendimiento): índices compuestos para el patrón de acceso dominante de
-- Finanzas/Analítica — "tenant + rango de fecha" — que hoy solo puede resolverse
-- combinando los índices de una sola columna (tenant_id_idx + sale_date_idx / etc.)
-- vía bitmap AND. Un índice compuesto es más eficiente cuando el volumen crezca por
-- tenant, y collections.collected_at no tenía NINGÚN índice propio (ni siquiera de
-- una sola columna) pese a ser la columna por la que filtran computeMonthlyPnl,
-- Finanzas > Resumen y Cohortes.
-- No destructivo, no bloqueante fuera de horario razonable (CREATE INDEX normal,
-- tablas de este tamaño no justifican CONCURRENTLY dentro de una migración transaccional).

CREATE INDEX IF NOT EXISTS sales_tenant_sale_date_idx ON public.sales (tenant_id, sale_date);
CREATE INDEX IF NOT EXISTS collections_tenant_collected_at_idx ON public.collections (tenant_id, collected_at);
CREATE INDEX IF NOT EXISTS commissions_tenant_status_idx ON public.commissions (tenant_id, status);
