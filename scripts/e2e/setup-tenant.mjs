// Aprovisiona el entorno E2E: idempotente, re-ejecutable N veces.
//
//   node scripts/e2e/setup-tenant.mjs [--reset]
//
// Crea (si no existen):
//   · tenant  slug 'qa-e2e' (status active)
//   · usuario auth admin@qa-e2e.test + fila users (rol 'admin') + tenant_members (admin)
//   · producto 'E2E Producto' con plan 'reserva' (300) y plan 'pago completo' (3000)
//   · contacto 'E2E Contacto'
//   · custom_field_defs 'E2E Campo Texto' (text) y 'E2E Campo Booleano' (boolean)
//
// Con --reset borra ventas/cobros del tenant antes (para re-ejecutar flujos que insertan).
// Credenciales: SOLO el password viene de env (E2E_PASSWORD); nunca se imprime.
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const RESET = args.includes('--reset')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.E2E_PASSWORD
if (!url || !serviceKey || !password) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o E2E_PASSWORD')
  process.exit(1)
}
const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const SLUG = 'qa-e2e'
const EMAIL = 'admin@qa-e2e.test'

// ── 1. TENANT ────────────────────────────────────────────────────────────────
let tenantId
{
  const { data } = await sb.from('tenants').select('id').eq('slug', SLUG).single()
  if (data) {
    tenantId = data.id
    await sb.from('tenants').update({ status: 'active' }).eq('id', tenantId)
  } else {
    const { data: created, error } = await sb
      .from('tenants')
      .insert({ slug: SLUG, name: 'QA E2E' })
      .select('id')
      .single()
    if (error) throw error
    tenantId = created.id
  }
}

// ── 2. ROL admin (global) ────────────────────────────────────────────────────
let roleId
{
  const { data } = await sb.from('roles').select('id').eq('key', 'admin').single()
  if (!data) throw new Error("rol 'admin' no existe en la BD")
  roleId = data.id
}

// ── 3. USUARIO auth + users + membership ─────────────────────────────────────
let userId
{
  const { data: listed } = await sb.auth.admin.listUsers()
  const existing = (listed?.users ?? []).find((u) => u.email === EMAIL)
  if (existing) {
    userId = existing.id
    await sb.auth.admin.updateUserById(userId, { password, email_confirm: true })
  } else {
    const { data: created, error } = await sb.auth.admin.createUser({ email: EMAIL, password, email_confirm: true })
    if (error) throw error
    userId = created.user.id
  }
  await sb
    .from('users')
    .upsert({ id: userId, full_name: 'QA E2E Admin', email: EMAIL, role_id: roleId, is_active: true })
  const { error } = await sb
    .from('tenant_members')
    .upsert({ tenant_id: tenantId, user_id: userId, role: 'admin' }, { onConflict: 'tenant_id,user_id' })
  if (error) throw error
}

// ── 4. PRODUCTO + PLANES ─────────────────────────────────────────────────────
let productId
{
  const { data } = await sb.from('products').select('id').eq('tenant_id', tenantId).eq('name', 'E2E Producto').single()
  if (data) productId = data.id
  else {
    const { data: created, error } = await sb
      .from('products')
      .insert({ tenant_id: tenantId, name: 'E2E Producto', description: 'Fixture E2E', is_active: true })
      .select('id')
      .single()
    if (error) throw error
    productId = created.id
  }
}
let reservaPlanId
let completoPlanId
{
  const { data: planes } = await sb
    .from('payment_plans')
    .select('id, name, method')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
  const reserva = planes?.find((p) => p.method === 'reserva')
  const completo = planes?.find((p) => p.method === 'stripe' || p.method === null)
  if (reserva) reservaPlanId = reserva.id
  else {
    const { data: created, error } = await sb
      .from('payment_plans')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        name: 'E2E Reserva',
        code: 'e2e_reserva',
        gross_price: 300,
        number_of_payments: 1,
        method: 'reserva',
        cash_collection_ratio: 1.0,
        is_active: true,
        sort_order: 1,
      })
      .select('id')
      .single()
    if (error) throw error
    reservaPlanId = created.id
  }
  if (completo) completoPlanId = completo.id
  else {
    const { data: created, error } = await sb
      .from('payment_plans')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        name: 'E2E Pago completo',
        code: 'e2e_completo',
        gross_price: 3000,
        number_of_payments: 1,
        method: 'stripe',
        cash_collection_ratio: 1.0,
        is_active: true,
        sort_order: 2,
      })
      .select('id')
      .single()
    if (error) throw error
    completoPlanId = created.id
  }
}

// ── 5. CONTACTO ──────────────────────────────────────────────────────────────
let contactId
{
  const { data } = await sb
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email', 'e2e-contacto@test.local')
    .single()
  if (data) contactId = data.id
  else {
    const { data: created, error } = await sb
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        full_name: 'E2E Contacto',
        email: 'e2e-contacto@test.local',
        first_name: 'E2E',
        last_name: 'Contacto',
      })
      .select('id')
      .single()
    if (error) throw error
    contactId = created.id
  }
}

// ── 6. CUSTOM FIELD DEFS ─────────────────────────────────────────────────────
{
  for (const def of [
    { field_key: 'e2e_campo_texto', label: 'E2E Campo Texto', field_type: 'text', sort_order: 1 },
    { field_key: 'e2e_campo_booleano', label: 'E2E Campo Booleano', field_type: 'boolean', sort_order: 2 },
  ]) {
    const { data: existing } = await sb
      .from('custom_field_defs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('field_key', def.field_key)
      .single()
    if (!existing) {
      const { error } = await sb.from('custom_field_defs').insert({ tenant_id: tenantId, ...def })
      if (error) throw error
    }
  }
}

// ── 7. RESET opcional de transaccional ───────────────────────────────────────
if (RESET) {
  await sb.from('collections').delete().eq('tenant_id', tenantId)
  await sb.from('sales').delete().eq('tenant_id', tenantId)
}

// ── SALIDA para Playwright (JSON en stdout, nada más) ────────────────────────
process.stdout.write(
  JSON.stringify({
    tenantId,
    userId,
    productId,
    reservaPlanId,
    completoPlanId,
    contactId,
    email: EMAIL,
    slug: SLUG,
  })
)
