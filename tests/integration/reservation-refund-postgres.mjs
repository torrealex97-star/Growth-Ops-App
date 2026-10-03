// Offline PostgreSQL behavior tests; no application credentials or customer data.
const { PGlite } = await import(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite')
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table appointments(id uuid,tenant_id uuid); create table tenant_members(tenant_id uuid,user_id uuid);
create table tenants(id uuid primary key); create table users(id uuid primary key);
create table payment_plans(id uuid primary key,tenant_id uuid,method text);
create table sales(id uuid primary key,tenant_id uuid,payment_plan_id uuid,status text,gross_amount numeric,reservation_completed_at timestamptz,updated_by uuid,converted_from_reservation_id uuid);
create table collections(id uuid primary key,tenant_id uuid,sale_id uuid,gross_amount numeric,commissionable_amount numeric,status text,payment_reference text);
create table refunds(id uuid primary key,tenant_id uuid,sale_id uuid,collection_id uuid,refund_date date,gross_refund_amount numeric,commissionable_refund_amount numeric,reason text,status text,created_by uuid,notes text);
create table commissions(id uuid primary key,tenant_id uuid,sale_id uuid);
create table stripe_payments(tenant_id uuid,payment_id text,charge_id text,currency text,amount numeric,refunded_amount numeric,status text,updated_at timestamptz);
create table audit_logs(tenant_id uuid,actor_user_id uuid,entity_type text,entity_id uuid,action text,new_values jsonb);
`)
await db.exec(`
alter table sales add appointment_id uuid,add product_id uuid,add sale_date date,add refund_deadline_at date,add expected_commissionable_amount numeric,add reservation_amount numeric,add down_payment_amount numeric,add installments_count int,add installments_start_date date,add payment_method text,add custom_plan jsonb,add payment_proof_path text,add setter_id uuid,add closer_id uuid,add affiliate_id uuid,add affiliate_commission_percent numeric,add buyer_is_scheduler boolean,add payer_data jsonb,add access_email text,add notes text;
alter table payment_plans add product_id uuid,add cash_collection_ratio numeric;
alter table collections alter id set default gen_random_uuid();
alter table collections add collected_at timestamptz,add payment_method text,add is_confirmed boolean,add is_eligible_for_commission boolean,add needs_commission_review boolean,add eligible_at timestamptz;
create table sale_expected_installments(tenant_id uuid,sale_id uuid,installment_number int,due_date date not null,expected_gross_amount numeric,expected_commissionable_amount numeric,status text,is_monitoring boolean);
`)
const migration = readFileSync(
  new URL('../../supabase/migrations/20261003135010_reservation_stripe_refunds.sql', import.meta.url),
  'utf8'
)
await db.exec('begin;' + migration + 'rollback;')
assert.equal((await db.query("select to_regclass('public.reservation_refund_requests') as t")).rows[0].t, null)
await db.exec(migration)
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const tenant = id(1),
  actor = id(2),
  plan = id(3),
  sale = id(4),
  collection = id(5),
  other = id(6)
await db.query('insert into tenants values($1),($2)', [tenant, other])
await db.query('insert into users values($1)', [actor])
await db.query("insert into payment_plans(id,tenant_id,method) values($1,$2,'reserva')", [plan, tenant])
await db.query("insert into sales(id,tenant_id,payment_plan_id,status,gross_amount) values($1,$2,$3,'active',50)", [
  sale,
  tenant,
  plan,
])
await db.query(
  "insert into collections(id,tenant_id,sale_id,gross_amount,commissionable_amount,status,payment_reference) values($1,$2,$3,50,50,'collected','pi_fixture')",
  [collection, tenant, sale]
)
await db.query("insert into stripe_payments values($1,'pi_fixture','ch_fixture','eur',50,0,'succeeded',now())", [
  tenant,
])
const claim = (tid = tenant, amount = 5000) =>
  db.query("select (claim_reservation_refund($1,$2,$3,'ch_fixture','acct_fixture',$4)).*", [tid, sale, actor, amount])
await assert.rejects(claim(other), /not found/)
await assert.rejects(claim(tenant, 6000), /reconciliation/)
const request = (await claim()).rows[0]
assert.equal((await claim()).rows[0].id, request.id)
assert.equal((await db.query('select count(*) from refunds')).rows[0].count, 0)
await assert.rejects(db.query('update sales set gross_amount=60 where id=$1', [sale]), /refund request/)
await assert.rejects(
  db.query(
    "insert into collections(id,tenant_id,sale_id,gross_amount,commissionable_amount,status,payment_reference) values($1,$2,$3,100,100,'collected','pi_other')",
    [id(7), tenant, sale]
  ),
  /refund request/
)
await assert.rejects(db.query('delete from collections where id=$1', [collection]), /refund request/)
await assert.rejects(db.query('update collections set sale_id=$1 where id=$2', [id(8), collection]), /Cannot move/)
await assert.rejects(
  db.query('insert into refunds(id,tenant_id,sale_id) values($1,$2,$3)', [id(9), tenant, sale]),
  /refund request/
)
await assert.rejects(db.query('insert into commissions values($1,$2,$3)', [id(10), tenant, sale]), /refund request/)
await assert.rejects(
  db.query("select finish_reservation_refund($1,$2,'re_fixture',current_date)", [other, request.id]),
  /Invalid/
)
const finish = () =>
  db.query("select finish_reservation_refund($1,$2,'re_fixture',current_date) as id", [tenant, request.id])
// A downstream failure must roll back ALL accounting, including the operational state.
await db.exec("alter table audit_logs add constraint reject_fixture check (action <> 'refund')")
await assert.rejects(finish(), /reject_fixture/)
assert.equal((await db.query('select count(*) from refunds')).rows[0].count, 0)
assert.equal((await db.query('select status from reservation_refund_requests')).rows[0].status, 'requested')
await db.exec('alter table audit_logs drop constraint reject_fixture')
await assert.rejects(
  db.query(
    "insert into sales(id,tenant_id,payment_plan_id,status,gross_amount,converted_from_reservation_id) values($1,$2,$3,'active',100,$4)",
    [id(20), tenant, plan, sale]
  ),
  /Cannot convert/
)
const refund = (await finish()).rows[0].id
assert.equal((await finish()).rows[0].id, refund)
assert.equal((await db.query('select count(*) from refunds')).rows[0].count, 1)
assert.equal((await db.query('select status from sales where id=$1', [sale])).rows[0].status, 'refunded')
assert.equal((await db.query('select refunded_amount from stripe_payments')).rows[0].refunded_amount, '50')
// Completing a reservation is atomic with the first new payment, never the deposit alone.
const reserve2 = id(30),
  col2 = id(31),
  finalPlan = id(32),
  product = id(33)
await db.query("insert into sales(id,tenant_id,payment_plan_id,status,gross_amount) values($1,$2,$3,'active',50)", [
  reserve2,
  tenant,
  plan,
])
await db.query(
  "insert into collections(id,tenant_id,sale_id,gross_amount,commissionable_amount,status) values($1,$2,$3,50,50,'collected')",
  [col2, tenant, reserve2]
)
await db.query("insert into payment_plans values($1,$2,'autofinanciado',$3,1)", [finalPlan, tenant, product])
const patch = {
  payment_plan_id: finalPlan,
  product_id: product,
  gross_amount: 300,
  reservation_amount: 50,
  payment_method: 'transferencia',
}
const finalCalendar = [
  {
    installment_number: 1,
    due_date: '2026-11-01',
    expected_gross_amount: 150,
    expected_commissionable_amount: 150,
    status: 'pending',
    is_monitoring: false,
  },
]
const complete = (payment = 100, installments = finalCalendar, tid = tenant) =>
  db.query('select complete_reservation_with_payment($1,$2,$3,$4,$5,$6)', [
    tid,
    reserve2,
    actor,
    JSON.stringify(patch),
    JSON.stringify(installments),
    payment,
  ])
await assert.rejects(complete(0), /first payment/)
await assert.rejects(complete(100, [], other), /not found/)
await assert.rejects(complete(100, [{ due_date: 'invalid', expected_gross_amount: 150, status: 'pending' }]), /date/)
assert.equal(
  (await db.query('select payment_plan_id from sales where id=$1', [reserve2])).rows[0].payment_plan_id,
  plan
)
assert.equal((await db.query('select count(*) from collections where sale_id=$1', [reserve2])).rows[0].count, 1)
patch.closer_id = actor
await assert.rejects(complete(), /Invalid team member/)
delete patch.closer_id
await complete()
await complete()
assert.equal((await db.query('select count(*) from collections where sale_id=$1', [reserve2])).rows[0].count, 2)
assert.equal(
  (await db.query('select sum(gross_amount) as total from collections where sale_id=$1', [reserve2])).rows[0].total,
  '150'
)
assert.equal(
  (await db.query('select payment_plan_id from sales where id=$1', [reserve2])).rows[0].payment_plan_id,
  finalPlan
)
await assert.rejects(db.query('update sales set tenant_id=$1 where id=$2', [other, sale]), /refund request/)
// Custom-plan entry preserves the existing commission-review rule after the deposit becomes eligible.
const customReserve = id(40),
  customPlan = id(41)
await db.query("insert into sales(id,tenant_id,payment_plan_id,status,gross_amount) values($1,$2,$3,'active',50)", [
  customReserve,
  tenant,
  plan,
])
await db.query(
  "insert into collections(id,tenant_id,sale_id,gross_amount,commissionable_amount,status,needs_commission_review,is_eligible_for_commission) values($1,$2,$3,50,50,'collected',true,false)",
  [id(42), tenant, customReserve]
)
await db.query("insert into payment_plans values($1,$2,'custom',$3,1)", [customPlan, tenant, product])
await db.query('select complete_reservation_with_payment($1,$2,$3,$4,$5,100)', [
  tenant,
  customReserve,
  actor,
  JSON.stringify({ ...patch, payment_plan_id: customPlan }),
  JSON.stringify(finalCalendar),
])
const cash = (
  await db.query(
    'select gross_amount,is_eligible_for_commission,needs_commission_review from collections where sale_id=$1 order by gross_amount',
    [customReserve]
  )
).rows
assert.equal(cash[0].is_eligible_for_commission, true)
assert.equal(cash[1].is_eligible_for_commission, false)
assert.equal(cash[1].needs_commission_review, true)
await db.exec('set role authenticated')
await assert.rejects(db.query('select * from reservation_refund_requests'), /permission denied/)
await assert.rejects(claim(), /permission denied/)
await db.close()
console.log(
  'PASS: tenant isolation, amount validation, durable retry, mutation guards, atomic finalization, RLS/EXECUTE restrictions'
)
