-- CONTEXTO DE NEGOCIO DEL GROWTH OPERATOR: lo que el agente no puede deducir de las tablas.
--
-- POR QUÉ HACE FALTA UNA TABLA Y NO SE DEDUCE. El precio de la oferta, el objetivo de facturación del
-- mes o la capacidad de llamadas de la semana no están en ningún sitio del que inferirlos sin riesgo:
-- derivar el precio de los cobros históricos es exactamente el error que hubo que corregir en `sales`
-- (facturación = clientes × precio comprometido, no la suma de lo cobrado), y un objetivo no existe en
-- los datos porque es una DECISIÓN. Un agente que se los invente produce diagnósticos creíbles y falsos.
--
-- Lo que no esté puesto aquí se declara AUSENTE en el prompt del agente (ver
-- lib/ai/agent/growth-operator.ts → describirContexto), nunca se rellena con un valor plausible.
--
-- UNA FILA POR SUBCUENTA. No hay histórico de versiones a propósito: el objetivo vigente es uno, y
-- cuando haga falta auditar "qué objetivo teníamos en julio" el sitio correcto es la tabla de
-- objetivos por periodo, no este registro de configuración.

create table if not exists public.growth_context (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,

  -- Contexto cualitativo. Va al prompt tal cual.
  business_type text,
  offer_name text,
  -- El precio COMPROMETIDO de la oferta, que es lo que factura un cliente nuevo. No es el cash
  -- cobrado: un plan a 10 plazos factura el total y cobra una décima parte cada mes.
  offer_price_eur numeric(12, 2),
  sales_cycle_days integer,

  -- Objetivos permanentes de economía unitaria. Son los que deciden si se puede escalar.
  target_monthly_revenue_eur numeric(14, 2),
  target_ltgp_cac numeric(8, 2),
  target_cash_roas numeric(8, 2),

  -- Techos operativos. Sin esto el agente no puede distinguir "no hay más demanda" de "no hay quien
  -- atienda la demanda que ya entra", que son problemas opuestos.
  capacity_calls_per_week integer,
  capacity_active_clients integer,

  notes text,

  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un precio o un objetivo negativo no es un dato raro: es un dato roto, y entraría en cada cálculo
  -- de LTGP:CAC del panel. Se permite NULL (no configurado) pero no un número imposible.
  constraint growth_context_offer_price_check check (offer_price_eur is null or offer_price_eur > 0),
  constraint growth_context_cycle_check check (sales_cycle_days is null or sales_cycle_days between 0 and 3650),
  constraint growth_context_revenue_check check (
    target_monthly_revenue_eur is null or target_monthly_revenue_eur > 0
  ),
  constraint growth_context_ltgp_check check (target_ltgp_cac is null or target_ltgp_cac > 0),
  constraint growth_context_roas_check check (target_cash_roas is null or target_cash_roas > 0),
  constraint growth_context_calls_check check (capacity_calls_per_week is null or capacity_calls_per_week > 0),
  constraint growth_context_clients_check check (capacity_active_clients is null or capacity_active_clients > 0)
);

alter table public.growth_context enable row level security;

-- El trío de siempre: escritura solo para quien dirige el negocio (un objetivo de facturación no lo
-- cambia un closer), lectura para el equipo, y aislamiento RESTRICTIVE por subcuenta que se aplica
-- ADEMÁS de las otras dos.
create policy growth_context_write on public.growth_context for all
  using (public.is_admin_or_director())
  with check (public.is_admin_or_director());

create policy growth_context_read on public.growth_context for select
  using (public.get_my_role() is not null);

create policy growth_context_tenant_isolation on public.growth_context as restrictive for all
  using (tenant_id in (select public.auth_tenant_ids()) or public.is_super_admin());
