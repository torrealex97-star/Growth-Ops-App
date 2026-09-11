-- Elimina la funcionalidad de "socios / reparto de beneficios" ([tenant], Alex,
-- [tenant] — ver settings/partners, pnl y finanzas/analitica/resumen). Clasificación:
-- SAFE_TO_REMOVE — `partners` solo guarda 3 filas de configuración de porcentaje de reparto,
-- no historial transaccional de negocio; no hay FKs de otras tablas apuntando a ella. La UI y
-- los cálculos que la usaban ya se retiraron del código en el mismo cambio que esta migración.
DROP TABLE IF EXISTS public.partners;
