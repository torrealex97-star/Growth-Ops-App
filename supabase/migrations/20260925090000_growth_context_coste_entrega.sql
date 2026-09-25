-- COSTE DE ENTREGA, la pieza que faltaba para LTGP:CAC.
--
-- LTGP:CAC (skill sales-engineering, §7 Métrología): LTGP = LTV - Costes Totales de Entrega;
-- Ratio = LTGP / CAC. El LTV real (facturación de por vida de un cliente) SÍ se puede calcular a
-- partir de `sales` — es una consulta nueva (agregación histórica, no por periodo), pero el dato
-- existe. Lo que NO existe en ningún sitio es el coste: cuánto cuesta entregar la oferta a UN
-- cliente. Sin este número, LTGP:CAC se queda en hueco (`sinDato`) aunque el resto del motor esté
-- listo — ver lib/metrics/agregados.ts.
--
-- Se guarda como coste MEDIO por cliente, no como % de facturación: growth_context ya declara el
-- precio de la oferta por separado, y expresarlo como euros absolutos evita mezclar dos supuestos
-- (precio y margen) en un solo número que nadie pueda auditar por separado.
alter table public.growth_context
  add column if not exists avg_delivery_cost_eur numeric(12, 2);

comment on column public.growth_context.avg_delivery_cost_eur is
  'Coste medio de entregar la oferta a UN cliente a lo largo de su vida (soporte, materiales, tiempo del equipo). Sin esto, LTGP:CAC queda sin dato aunque haya facturación.';
