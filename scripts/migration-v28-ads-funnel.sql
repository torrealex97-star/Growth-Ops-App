-- v28 — Métricas de funnel de ads en `campaigns`.
-- Amplía la ingesta de Meta (clics de enlace + visitas a la página) y guarda el
-- cruce con el CRM (agendas, llamadas/show-ups, cierres, facturación) por campaña.
-- Todo lo derivado (CPM, CPC, CTR, %Carga, CPL, %Registro, %Conversión VSL,
-- %Show Up, %Cierre, CPA) se calcula en el frontend a partir de estas columnas.

-- Meta (ampliación de insights)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS link_clicks BIGINT NOT NULL DEFAULT 0;   -- inline_link_clicks
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS landing_views BIGINT NOT NULL DEFAULT 0;  -- landing_page_view (actions)

-- CRM (cruce por UTM del contacto → appointments / sales)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS appointments_count INTEGER NOT NULL DEFAULT 0; -- Agendas atribuidas
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS shows_count INTEGER NOT NULL DEFAULT 0;        -- Llamadas (show up: show/completed)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS sales_count INTEGER NOT NULL DEFAULT 0;        -- Cierres (active/partial_refund)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS sales_revenue NUMERIC NOT NULL DEFAULT 0;      -- Facturación atribuida (gross)
