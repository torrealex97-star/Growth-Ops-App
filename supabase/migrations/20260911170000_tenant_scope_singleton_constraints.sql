-- BUGFIX (regresión de la migración multi-tenant, no hardening rutinario).
--
-- 20260911150000 añadió tenant_id NOT NULL a estas tablas, pero dejó sus constraints de
-- unicidad/PK originales sin tocar, que seguían pensadas para una única fila/valor GLOBAL:
--
--   · company_profile / affiliate_program_settings / sales_tramos_config: PK en id con
--     CHECK(id = 1) — solo puede existir UNA fila en total entre TODAS las subcuentas, no
--     una por tenant. La segunda subcuenta que intente guardar su perfil de empresa,
--     configuración de afiliados o config de tramos choca con la fila de la primera.
--   · app_settings: PK en key — dos subcuentas no pueden tener cada una su propio
--     'ig_style_prompt'.
--   · sequra_delinquent_customers: UNIQUE(order_reference) global + CHECK(merchant_reference
--     = '<merchant-del-tenant>') — bloquea a cualquier subcuenta que no sea la sembrada, y ya no tiene
--     sentido con SEQURA_MERCHANT_REFERENCE configurable por tenant (ver
--     lib/sequra/syncDelinquents.ts).
--   · canonical_events: UNIQUE(source, idempotency_key) y UNIQUE(source, event_id) globales
--     — dos subcuentas podrían compartir el mismo idempotency_key/event_id sin colisionar
--     realmente entre sí (son fuentes de tracking independientes).
--
-- Aplica el mismo patrón en las seis: la fila/valor pasa a ser único POR TENANT, no global.
-- Los nombres de constraint below son los que Postgres asigna por defecto a partir del DDL
-- original (supabase/migrations/20260910110000_restore_original_features.sql y
-- 20260911100000_tracking_data_health.sql) — DROP...IF EXISTS es seguro si algún nombre
-- difiriera.

-- ── company_profile: PK(id) + CHECK(id=1) → PK(tenant_id) ────────────────────
ALTER TABLE public.company_profile DROP CONSTRAINT IF EXISTS company_profile_pkey;
ALTER TABLE public.company_profile DROP CONSTRAINT IF EXISTS company_profile_singleton;
ALTER TABLE public.company_profile ADD CONSTRAINT company_profile_pkey PRIMARY KEY (tenant_id);

-- ── affiliate_program_settings: igual patrón ──────────────────────────────────
ALTER TABLE public.affiliate_program_settings DROP CONSTRAINT IF EXISTS affiliate_program_settings_pkey;
ALTER TABLE public.affiliate_program_settings DROP CONSTRAINT IF EXISTS affiliate_program_settings_singleton;
ALTER TABLE public.affiliate_program_settings ADD CONSTRAINT affiliate_program_settings_pkey PRIMARY KEY (tenant_id);

-- ── sales_tramos_config: igual patrón ─────────────────────────────────────────
ALTER TABLE public.sales_tramos_config DROP CONSTRAINT IF EXISTS sales_tramos_config_pkey;
ALTER TABLE public.sales_tramos_config DROP CONSTRAINT IF EXISTS sales_tramos_config_id_check;
ALTER TABLE public.sales_tramos_config ADD CONSTRAINT sales_tramos_config_pkey PRIMARY KEY (tenant_id);

-- ── app_settings: PK(key) → PK(tenant_id, key) ────────────────────────────────
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (tenant_id, key);

-- ── sequra_delinquent_customers: UNIQUE(order_reference) global → por tenant;
--    quita el CHECK que fijaba el merchant a '[tenant]' para siempre ────────
ALTER TABLE public.sequra_delinquent_customers DROP CONSTRAINT IF EXISTS sequra_delinquent_customers_order_reference_key;
ALTER TABLE public.sequra_delinquent_customers ADD CONSTRAINT sequra_delinquent_customers_tenant_order_key UNIQUE (tenant_id, order_reference);
ALTER TABLE public.sequra_delinquent_customers DROP CONSTRAINT IF EXISTS sequra_delinquent_customers_merchant_reference_check;

-- ── canonical_events: UNIQUE(source, ...) global → por tenant ────────────────
ALTER TABLE public.canonical_events DROP CONSTRAINT IF EXISTS canonical_events_source_idempotency_key_key;
ALTER TABLE public.canonical_events ADD CONSTRAINT canonical_events_tenant_source_idempotency_key UNIQUE (tenant_id, source, idempotency_key);
ALTER TABLE public.canonical_events DROP CONSTRAINT IF EXISTS canonical_events_source_event_id_key;
ALTER TABLE public.canonical_events ADD CONSTRAINT canonical_events_tenant_source_event_id_key UNIQUE (tenant_id, source, event_id);
