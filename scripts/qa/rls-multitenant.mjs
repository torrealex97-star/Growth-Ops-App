// Sonda LIVE, reproducible y autolimpiable para el límite de seguridad entre dos subcuentas.
// No forma parte de `npm test`: requiere credenciales y confirmación explícita.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config()

if (process.env.RLS_LIVE_CONFIRM !== '1') {
  throw new Error('Define RLS_LIVE_CONFIRM=1 para ejecutar la sonda live con fixtures autolimpiables.')
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceKey) throw new Error('Faltan credenciales de Supabase.')

const run = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
const password = `${randomUUID()}Aa1!`
const emailA = `qa-rls-a-${run}@example.test`
const emailDual = `qa-rls-dual-${run}@example.test`
const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const created = { tenantIds: [], userIds: [], contactIds: [] }
const fail = (label, error) => {
  if (error) throw new Error(`${label}: ${error.message}`)
}

async function authenticated(email) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  fail(`login ${email}`, error)
  return client
}

try {
  const { data: adminRole, error: roleError } = await service.from('roles').select('id').eq('key', 'admin').single()
  fail('rol admin', roleError)

  for (const suffix of ['a', 'b']) {
    const { data, error } = await service
      .from('tenants')
      .insert({ slug: `qa-rls-${suffix}-${run}`, name: `QA RLS Tenant ${suffix.toUpperCase()}`, status: 'active' })
      .select('id')
      .single()
    fail(`crear tenant ${suffix}`, error)
    created.tenantIds.push(data.id)
  }
  const [tenantA, tenantB] = created.tenantIds

  for (const [email, name] of [
    [emailA, 'QA RLS A-only'],
    [emailDual, 'QA RLS Dual'],
  ]) {
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
    fail(`crear auth ${email}`, error)
    created.userIds.push(data.user.id)
    const { error: userError } = await service.from('users').upsert({
      id: data.user.id,
      full_name: name,
      email,
      role_id: adminRole.id,
      is_active: true,
    })
    fail(`crear users ${email}`, userError)
  }
  const [userA, userDual] = created.userIds
  const { error: memberError } = await service.from('tenant_members').insert([
    { tenant_id: tenantA, user_id: userA, role: 'admin' },
    { tenant_id: tenantA, user_id: userDual, role: 'admin' },
    { tenant_id: tenantB, user_id: userDual, role: 'admin' },
  ])
  fail('crear membresías', memberError)

  const onlyA = await authenticated(emailA)
  const dual = await authenticated(emailDual)
  const contactA = randomUUID()
  const contactB = randomUUID()
  created.contactIds.push(contactA, contactB)

  fail(
    'insert A',
    (await onlyA.from('contacts').insert({ id: contactA, tenant_id: tenantA, full_name: `QA RLS A ${run}` })).error
  )
  const deniedInsert = await onlyA
    .from('contacts')
    .insert({ tenant_id: tenantB, full_name: `QA RLS B denegado ${run}` })
  assert.ok(deniedInsert.error, 'INSERT cross-tenant debe ser rechazado por RLS')
  fail(
    'insert B dual',
    (await dual.from('contacts').insert({ id: contactB, tenant_id: tenantB, full_name: `QA RLS B ${run}` })).error
  )

  const visibleA = await onlyA.from('contacts').select('id,tenant_id').in('id', [contactA, contactB])
  fail('select A', visibleA.error)
  assert.deepEqual(visibleA.data, [{ id: contactA, tenant_id: tenantA }])
  const visibleDual = await dual.from('contacts').select('id,tenant_id').in('id', [contactA, contactB])
  fail('select dual', visibleDual.error)
  assert.equal(visibleDual.data.length, 2, 'el miembro dual debe ver ambas subcuentas')

  const deniedUpdate = await onlyA
    .from('contacts')
    .update({ full_name: 'NO DEBE CAMBIAR' })
    .eq('id', contactB)
    .select('id')
  fail('update B desde A', deniedUpdate.error)
  assert.equal(deniedUpdate.data.length, 0)
  const allowedUpdate = await dual
    .from('contacts')
    .update({ full_name: `QA RLS B actualizado ${run}` })
    .eq('id', contactB)
    .select('id')
  fail('update B dual', allowedUpdate.error)
  assert.equal(allowedUpdate.data.length, 1)

  const deniedDelete = await onlyA.from('contacts').delete().eq('id', contactB).select('id')
  fail('delete B desde A', deniedDelete.error)
  assert.equal(deniedDelete.data.length, 0)
  const deleteA = await onlyA.from('contacts').delete().eq('id', contactA).select('id')
  fail('delete A', deleteA.error)
  assert.equal(deleteA.data.length, 1)
  const deleteB = await dual.from('contacts').delete().eq('id', contactB).select('id')
  fail('delete B dual', deleteB.error)
  assert.equal(deleteB.data.length, 1)

  console.log('PASS: RLS ORG_A/ORG_B SELECT/INSERT/UPDATE/DELETE + usuario miembro de ambas subcuentas')
} finally {
  if (created.contactIds.length) await service.from('contacts').delete().in('id', created.contactIds)
  if (created.userIds.length) {
    await service.from('tenant_members').delete().in('user_id', created.userIds)
    await service.from('users').delete().in('id', created.userIds)
    for (const userId of created.userIds) await service.auth.admin.deleteUser(userId)
  }
  if (created.tenantIds.length) await service.from('tenants').delete().in('id', created.tenantIds)
}
