-- Reduce el coste por fila de RLS sin cambiar ninguna regla de acceso.
--
-- Postgres puede convertir auth.uid() en un InitPlan cuando se envuelve en SELECT:
-- se evalúa una vez por statement en lugar de una vez por fila. Reescribimos las
-- expresiones existentes en vez de volver a declarar las policies a mano; así se
-- preservan exactamente roles, comandos, USING y WITH CHECK del esquema vigente.
do $$
declare
  p record;
  optimized_qual text;
  optimized_check text;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ~ 'auth[.](uid|role|jwt)[(][)]'
        or coalesce(with_check, '') ~ 'auth[.](uid|role|jwt)[(][)]'
      )
  loop
    optimized_qual := p.qual;
    optimized_check := p.with_check;

    if optimized_qual is not null then
      optimized_qual := replace(optimized_qual, 'auth.uid()', '(select auth.uid())');
      optimized_qual := replace(optimized_qual, 'auth.role()', '(select auth.role())');
      optimized_qual := replace(optimized_qual, 'auth.jwt()', '(select auth.jwt())');
    end if;

    if optimized_check is not null then
      optimized_check := replace(optimized_check, 'auth.uid()', '(select auth.uid())');
      optimized_check := replace(optimized_check, 'auth.role()', '(select auth.role())');
      optimized_check := replace(optimized_check, 'auth.jwt()', '(select auth.jwt())');
    end if;

    if optimized_qual is not null and optimized_check is not null then
      execute format(
        'alter policy %I on public.%I using (%s) with check (%s)',
        p.policyname,
        p.tablename,
        optimized_qual,
        optimized_check
      );
    elsif optimized_qual is not null then
      execute format(
        'alter policy %I on public.%I using (%s)',
        p.policyname,
        p.tablename,
        optimized_qual
      );
    elsif optimized_check is not null then
      execute format(
        'alter policy %I on public.%I with check (%s)',
        p.policyname,
        p.tablename,
        optimized_check
      );
    end if;
  end loop;
end
$$;

-- El advisor detectó dos índices byte-a-byte equivalentes sobre campaign_id.
-- Conservamos el nombre descriptivo creado primero y retiramos la copia.
drop index if exists public.idx_cfa_campaign;

-- FKs de tablas que reciben sincronizaciones o participan en recorridos de negocio.
-- Además de acelerar joins/filtros, evitan scans completos al actualizar/borrar la
-- fila referenciada. No indexamos aquí tablas pequeñas y estáticas sin uso medido.
create index if not exists appointments_offered_by_idx
  on public.appointments (offered_by)
  where offered_by is not null;

create index if not exists contact_attributions_collaborator_id_idx
  on public.contact_attributions (collaborator_id)
  where collaborator_id is not null;

create index if not exists email_events_tenant_id_idx
  on public.email_events (tenant_id);

create index if not exists social_raw_payloads_tenant_id_idx
  on public.social_raw_payloads (tenant_id);

create index if not exists reservation_refund_requests_sale_id_idx
  on public.reservation_refund_requests (sale_id);

create index if not exists reservation_refund_requests_collection_id_idx
  on public.reservation_refund_requests (collection_id);

create index if not exists reservation_refund_requests_refund_id_idx
  on public.reservation_refund_requests (refund_id)
  where refund_id is not null;

create index if not exists stripe_price_map_product_id_idx
  on public.stripe_price_map (product_id);

create index if not exists stripe_price_map_payment_plan_id_idx
  on public.stripe_price_map (payment_plan_id)
  where payment_plan_id is not null;
