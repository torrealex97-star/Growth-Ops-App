// Run with PGLITE_TEST_MODULE pointing to an isolated @electric-sql/pglite installation.
// This suite never connects to the application database.
const { PGlite } = await import(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite')
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table contacts(id uuid primary key,tenant_id uuid);
create table payment_plans(id uuid primary key,tenant_id uuid,product_id uuid,is_active boolean,method text,cash_collection_ratio numeric);
create table sales(id uuid primary key default gen_random_uuid(),tenant_id uuid,contact_id uuid,product_id uuid,payment_plan_id uuid,sale_date date,refund_deadline_at date,gross_amount numeric,expected_commissionable_amount numeric,closer_id uuid,setter_id uuid,created_by uuid,payment_method text,status text,down_payment_amount numeric,installments_count int,installments_start_date date,notes text,reservation_completed_at timestamptz);
create table collections(id uuid primary key default gen_random_uuid(),tenant_id uuid,sale_id uuid,collected_at timestamptz,gross_amount numeric,commissionable_amount numeric,processing_fee numeric,payment_method text,payment_provider text,payment_reference text,is_confirmed boolean,is_eligible_for_commission boolean,needs_commission_review boolean,eligible_at timestamptz,status text,unique(tenant_id,payment_reference));
create table sale_expected_installments(tenant_id uuid,sale_id uuid,installment_number int,due_date date,expected_gross_amount numeric,expected_commissionable_amount numeric,status text);
create table audit_logs(tenant_id uuid,actor_user_id uuid,entity_type text,entity_id uuid,action text,new_values jsonb);
`)
await db.exec(
  readFileSync(new URL('../../supabase/migrations/20260928191947_resolve_payment_inbox.sql', import.meta.url), 'utf8')
)
const tenant = '00000000-0000-4000-8000-000000000001',
  actor = '00000000-0000-4000-8000-000000000002',
  contact = '00000000-0000-4000-8000-000000000003',
  product = '00000000-0000-4000-8000-000000000004',
  plan = '00000000-0000-4000-8000-000000000005'
await db.query('insert into contacts values($1,$2)', [contact, tenant])
await db.query("insert into payment_plans values($1,$2,$3,true,'full_pay',1)", [plan, tenant, product])
const sale = {
  contact_id: contact,
  product_id: product,
  payment_plan_id: plan,
  gross_amount: 100,
  sale_date: '2026-09-01',
  refund_deadline_at: '2026-09-16',
  closer_id: actor,
  setter_id: null,
  installments_count: null,
  installments_start_date: null,
}
async function resolve(payment = 'pi_test', sid = null, data = sale, charge = 'ch_test') {
  return (
    await db.query('select resolve_payment_inbox($1,$2,$3,$4,100,3,$5,$6,$7,$8) as result', [
      tenant,
      actor,
      payment,
      charge,
      '2026-09-01T12:00:00Z',
      sid,
      data,
      [],
    ])
  ).rows[0].result
}
const result = await resolve()
assert.ok(result.saleId)
assert.equal(result.alreadyRecorded, false)
assert.equal((await resolve()).saleId, result.saleId)
assert.equal((await db.query('select count(*)::int as n from sales')).rows[0].n, 1)
assert.equal((await db.query('select count(*)::int as n from collections')).rows[0].n, 1)
const second = await resolve('pi_second', result.saleId, null, 'ch_second')
assert.equal(second.saleId, result.saleId)
assert.equal((await db.query('select count(*)::int as n from sales')).rows[0].n, 1)
await assert.rejects(resolve('pi_invalid', null, { ...sale, product_id: actor }, 'ch_invalid'))
assert.equal((await db.query('select count(*)::int as n from sales')).rows[0].n, 1)
await db.query(
  "insert into collections(tenant_id,sale_id,collected_at,gross_amount,status) values($1,$2,'2026-09-01T12:00:00Z',100,'collected')",
  [tenant, result.saleId]
)
await assert.rejects(resolve('pi_manual', null, sale, 'ch_manual'), /PENDING_MANUAL_MATCH/)
assert.equal((await db.query('select count(*)::int as n from sales')).rows[0].n, 1)
const perms = await db.query(
  "select has_function_privilege('authenticated','public.resolve_payment_inbox(uuid,uuid,text,text,numeric,numeric,timestamptz,uuid,jsonb,jsonb)','EXECUTE') as allowed"
)
assert.equal(perms.rows[0].allowed, false)
await assert.rejects(resolve('pi_cross_tenant', '00000000-0000-4000-8000-000000000099', null, 'ch_cross'))
console.log(
  'PASS: new sale+receipt, repeat idempotence, existing sale, rollback invalid plan, rollback manual duplicate, browser execution denied'
)
await db.close()
