-- Separate operational ledger: pending requests must never count as money returned.
create table public.reservation_refund_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  sale_id uuid not null references public.sales(id),
  collection_id uuid not null references public.collections(id),
  charge_id text not null check (charge_id ~ '^ch_[A-Za-z0-9]+$'),
  stripe_account_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  requested_by uuid not null references public.users(id),
  status text not null default 'requested' check (status in ('requested','pending','succeeded','failed')),
  stripe_refund_id text,
  refund_id uuid references public.refunds(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sale_id),
  unique (stripe_account_id, charge_id)
);
alter table public.reservation_refund_requests enable row level security;
-- No client policies: financial requests are accessed only after server authorization.
revoke all on public.reservation_refund_requests from anon, authenticated;
grant all on public.reservation_refund_requests to service_role;

create function public.claim_reservation_refund(
  p_tenant uuid, p_sale uuid, p_actor uuid, p_charge text, p_account text, p_amount bigint
) returns public.reservation_refund_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.sales; c public.collections; r public.reservation_refund_requests; n integer;
begin
  select * into s from public.sales where tenant_id=p_tenant and id=p_sale for update;
  if not found then raise exception 'Reservation not found'; end if;
  select * into r from public.reservation_refund_requests where tenant_id=p_tenant and sale_id=p_sale;
  if found then
    if r.amount_cents<>p_amount or r.charge_id<>p_charge or r.stripe_account_id<>p_account then
      raise exception 'Refund request changed';
    end if;
    return r;
  end if;
  if s.status<>'active' or s.reservation_completed_at is not null or not exists (
    select 1 from public.payment_plans where id=s.payment_plan_id and tenant_id=p_tenant and method='reserva'
  ) then raise exception 'Not an open reservation'; end if;
  select count(*) into n from public.collections where tenant_id=p_tenant and sale_id=p_sale and status='collected';
  if n<>1 then raise exception 'Reservation requires payment review'; end if;
  select * into c from public.collections where tenant_id=p_tenant and sale_id=p_sale and status='collected';
  if round(c.gross_amount*100)<>p_amount or round(s.gross_amount*100)<>p_amount
     or not exists (select 1 from public.stripe_payments sp where sp.tenant_id=p_tenant
       and sp.charge_id=p_charge and c.payment_reference in (sp.charge_id,sp.payment_id)
       and lower(sp.currency)='eur' and round(sp.amount*100)=p_amount)
     or exists (select 1 from public.sales where tenant_id=p_tenant and converted_from_reservation_id=p_sale)
     or exists (select 1 from public.refunds where tenant_id=p_tenant and sale_id=p_sale)
     or exists (select 1 from public.commissions where tenant_id=p_tenant and sale_id=p_sale)
  then raise exception 'Reservation requires financial reconciliation'; end if;
  insert into public.reservation_refund_requests(tenant_id,sale_id,collection_id,charge_id,stripe_account_id,amount_cents,requested_by)
    values(p_tenant,p_sale,c.id,p_charge,p_account,p_amount,p_actor) returning * into r;
  return r;
end $$;
revoke all on function public.claim_reservation_refund(uuid,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.claim_reservation_refund(uuid,uuid,uuid,text,text,bigint) to service_role;

-- Serialize competing edits/collections against the same sale before the external effect.
create function public.guard_reservation_refund() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; tid uuid; r public.reservation_refund_requests;
begin
  if tg_table_name='sales' and tg_op<>'DELETE' then
    if new.converted_from_reservation_id is not null then
      perform 1 from public.sales where tenant_id=new.tenant_id and id=new.converted_from_reservation_id for update;
      if exists(select 1 from public.reservation_refund_requests where tenant_id=new.tenant_id and sale_id=new.converted_from_reservation_id and status in ('requested','pending','succeeded')) then
        raise exception 'Cannot convert a reservation during a refund';
      end if;
    end if;
    if tg_op='INSERT' then return new; end if;
  end if;
  if tg_table_name<>'sales' and tg_op='UPDATE' then
    if new.sale_id is distinct from old.sale_id or new.tenant_id is distinct from old.tenant_id then
      perform 1 from public.sales where id=old.sale_id and tenant_id=old.tenant_id for update;
      if exists(select 1 from public.reservation_refund_requests where tenant_id=old.tenant_id and sale_id=old.sale_id and status in ('requested','pending','succeeded')) then
        raise exception 'Cannot move a payment during a reservation refund';
      end if;
    end if;
  end if;
  if tg_table_name='sales' then sid=old.id; tid=old.tenant_id;
  elsif tg_op='DELETE' then sid=old.sale_id; tid=old.tenant_id;
  else sid=new.sale_id; tid=new.tenant_id; end if;
  perform 1 from public.sales where id=sid and tenant_id=tid for update;
  select * into r from public.reservation_refund_requests where sale_id=sid and tenant_id=tid;
  if found and r.status in ('requested','pending','succeeded') then
    -- Atomic finalizer records the exact refund and closes the sale after setting succeeded.
    if tg_table_name='refunds' and tg_op='INSERT' and r.status='succeeded' and new.id=r.refund_id then return new; end if;
    if tg_table_name='sales' and tg_op='UPDATE' and r.status='succeeded' then
      if new.status='refunded' and (to_jsonb(new)-array['status','updated_by','updated_at']) = (to_jsonb(old)-array['status','updated_by','updated_at'])
      then return new; end if;
    end if;
    raise exception 'Reservation has a Stripe refund request; reconcile it before changing the sale';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger reservation_refund_sales_guard before insert or update or delete on public.sales for each row execute function public.guard_reservation_refund();
create trigger reservation_refund_collections_guard before insert or update or delete on public.collections for each row execute function public.guard_reservation_refund();
create trigger reservation_refund_refunds_guard before insert or update or delete on public.refunds for each row execute function public.guard_reservation_refund();
create trigger reservation_refund_commissions_guard before insert or update or delete on public.commissions for each row execute function public.guard_reservation_refund();

create function public.finish_reservation_refund(p_tenant uuid,p_request uuid,p_stripe_refund text,p_date date)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reservation_refund_requests; c public.collections; fid uuid;
begin
  -- Same lock ordering as the claim and guards.
  perform 1 from public.sales where tenant_id=p_tenant and id=(select sale_id from public.reservation_refund_requests where tenant_id=p_tenant and id=p_request) for update;
  select * into r from public.reservation_refund_requests where tenant_id=p_tenant and id=p_request for update;
  if not found or p_stripe_refund !~ '^re_[A-Za-z0-9]+$' then raise exception 'Invalid refund request'; end if;
  if r.status='succeeded' then
    if r.stripe_refund_id<>p_stripe_refund then raise exception 'Refund identity changed'; end if;
    return r.refund_id;
  end if;
  if r.status='failed' or (r.stripe_refund_id is not null and r.stripe_refund_id<>p_stripe_refund) then raise exception 'Refund identity changed'; end if;
  select * into strict c from public.collections where tenant_id=p_tenant and id=r.collection_id;
  fid=gen_random_uuid();
  -- Deferred FK allows the guarded insert in this same transaction.
  update public.reservation_refund_requests set status='succeeded',stripe_refund_id=p_stripe_refund,refund_id=fid,updated_at=now() where id=r.id;
  insert into public.refunds(id,tenant_id,sale_id,collection_id,refund_date,gross_refund_amount,commissionable_refund_amount,reason,status,created_by,notes)
    values(fid,p_tenant,r.sale_id,c.id,p_date,r.amount_cents/100.0,c.commissionable_amount,'Reserva reembolsada en Stripe','processed',r.requested_by,p_stripe_refund);
  update public.sales set status='refunded',updated_by=r.requested_by where id=r.sale_id and tenant_id=p_tenant;
  update public.stripe_payments set refunded_amount=amount,status='refunded',updated_at=now() where tenant_id=p_tenant and charge_id=r.charge_id;
  insert into public.audit_logs(tenant_id,actor_user_id,entity_type,entity_id,action,new_values)
    values(p_tenant,r.requested_by,'sale',r.sale_id,'refund',jsonb_build_object('refund_id',fid,'stripe_refund_id',p_stripe_refund,'gross_refund',r.amount_cents/100.0));
  return fid;
end $$;
alter table public.reservation_refund_requests drop constraint reservation_refund_requests_refund_id_fkey;
alter table public.reservation_refund_requests add constraint reservation_refund_requests_refund_id_fkey foreign key(refund_id) references public.refunds(id) deferrable initially deferred;
revoke all on function public.finish_reservation_refund(uuid,uuid,text,date) from public,anon,authenticated;
grant execute on function public.finish_reservation_refund(uuid,uuid,text,date) to service_role;

-- The deposit, first actual installment and final plan are one transition, never three HTTP writes.
create function public.complete_reservation_with_payment(p_tenant uuid,p_sale uuid,p_actor uuid,p_patch jsonb,p_installments jsonb,p_first_payment numeric)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.sales; target public.sales; plan public.payment_plans; collected numeric; cid uuid; inst jsonb;
begin
  select * into s from public.sales where tenant_id=p_tenant and id=p_sale for update;
  if not found then raise exception 'Reservation not found'; end if;
  select * into target from jsonb_populate_record(s,p_patch);
  if s.reservation_completed_at is not null then
    if s.status='active' and s.payment_plan_id=target.payment_plan_id and s.gross_amount=target.gross_amount then return s.id; end if;
    raise exception 'Reservation already converted';
  end if;
  if s.status<>'active' or not exists(select 1 from public.payment_plans where tenant_id=p_tenant and id=s.payment_plan_id and method='reserva') then raise exception 'Not an open reservation'; end if;
  select * into plan from public.payment_plans where tenant_id=p_tenant and id=target.payment_plan_id and product_id=target.product_id and method<>'reserva';
  if not found then raise exception 'Invalid final payment plan'; end if;
  if target.appointment_id is not null and not exists(select 1 from public.appointments where tenant_id=p_tenant and id=target.appointment_id) then raise exception 'Invalid appointment'; end if;
  if exists(select 1 from unnest(array[target.setter_id,target.closer_id,target.affiliate_id]) u(id) where u.id is not null and not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant and tm.user_id=u.id)) then raise exception 'Invalid team member'; end if;
  if p_first_payment is null or p_first_payment<=0 or p_first_payment<>round(p_first_payment,2)
     or target.gross_amount<=s.gross_amount or p_first_payment>target.gross_amount-s.gross_amount
     or target.reservation_amount is distinct from s.gross_amount then raise exception 'A first payment is required'; end if;
  select coalesce(sum(gross_amount),0) into collected from public.collections where tenant_id=p_tenant and sale_id=p_sale and status='collected';
  if collected<>s.gross_amount or exists(select 1 from public.refunds where tenant_id=p_tenant and sale_id=p_sale) then raise exception 'Reconcile the original deposit before conversion'; end if;
  if plan.method='sequra' then
    if p_first_payment<>round(target.gross_amount*coalesce(plan.cash_collection_ratio,1)-s.gross_amount,2) then raise exception 'Invalid financing payout'; end if;
  elsif coalesce((select sum((value->>'expected_gross_amount')::numeric) from jsonb_array_elements(p_installments) where not coalesce((value->>'is_monitoring')::boolean,false)),0)<>target.gross_amount-s.gross_amount-p_first_payment then
    raise exception 'Installment calendar does not match the outstanding amount';
  end if;
  -- No financial fields are copied from untrusted JSON beyond this explicit list.
  update public.sales set appointment_id=target.appointment_id, product_id=target.product_id,payment_plan_id=target.payment_plan_id,
    sale_date=target.sale_date,refund_deadline_at=target.refund_deadline_at,gross_amount=target.gross_amount,
    expected_commissionable_amount=target.expected_commissionable_amount,reservation_amount=s.gross_amount,
    down_payment_amount=target.down_payment_amount,installments_count=target.installments_count,installments_start_date=target.installments_start_date,
    reservation_completed_at=now(),payment_method=target.payment_method,custom_plan=target.custom_plan,payment_proof_path=target.payment_proof_path,
    setter_id=target.setter_id,closer_id=target.closer_id,affiliate_id=target.affiliate_id,affiliate_commission_percent=target.affiliate_commission_percent,
    buyer_is_scheduler=target.buyer_is_scheduler,payer_data=target.payer_data,access_email=target.access_email,notes=target.notes,updated_by=p_actor
    where tenant_id=p_tenant and id=p_sale;
  delete from public.sale_expected_installments where tenant_id=p_tenant and sale_id=p_sale;
  for inst in select value from jsonb_array_elements(p_installments) loop
    if (inst->>'expected_gross_amount')::numeric < 0 or (inst->>'status') is distinct from 'pending' then raise exception 'Invalid installment'; end if;
    insert into public.sale_expected_installments(tenant_id,sale_id,installment_number,due_date,expected_gross_amount,expected_commissionable_amount,status,is_monitoring)
      values(p_tenant,p_sale,(inst->>'installment_number')::int,(inst->>'due_date')::date,(inst->>'expected_gross_amount')::numeric,(inst->>'expected_commissionable_amount')::numeric,'pending',coalesce((inst->>'is_monitoring')::boolean,false));
  end loop;
  update public.collections set needs_commission_review=false,is_eligible_for_commission=true,eligible_at=now() where tenant_id=p_tenant and sale_id=p_sale and status='collected' and needs_commission_review=true;
  insert into public.collections(tenant_id,sale_id,collected_at,gross_amount,commissionable_amount,payment_method,is_confirmed,is_eligible_for_commission,needs_commission_review,eligible_at,status)
    values(p_tenant,p_sale,now(),p_first_payment,case when plan.method='sequra' then p_first_payment else round(p_first_payment*coalesce(plan.cash_collection_ratio,1),2) end,target.payment_method,true,plan.method<>'custom',plan.method='custom',case when plan.method<>'custom' then now() else null end,'collected') returning id into cid;
  insert into public.audit_logs(tenant_id,actor_user_id,entity_type,entity_id,action,new_values)
    values(p_tenant,p_actor,'sale',p_sale,'update',jsonb_build_object('_accion','completar_reserva','first_collection_id',cid,'first_payment',p_first_payment));
  return p_sale;
end $$;
revoke all on function public.complete_reservation_with_payment(uuid,uuid,uuid,jsonb,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.complete_reservation_with_payment(uuid,uuid,uuid,jsonb,jsonb,numeric) to service_role;
