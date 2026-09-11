// Siembra de datos DEMO para ver el centro de mando funcionando.
// Todo va marcado: equipo @demo.closer, ventas/contactos notes='[DEMO]', productos '(demo)'.
// Ejecutar: SUPABASE_URL=... SERVICE_KEY=... node scripts/seed-demo.mjs
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SERVICE_KEY
const ADMIN_ID = process.env.ADMIN_ID // created_by
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const ROLE = { closer: 'c6ffb338-dc91-4e93-bbbb-ea3ec4d9ee42', setter: '1c650ca2-a95b-4591-bc2b-a00e788e9d26' }
const pad = (n) => String(n).padStart(2, '0')
const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const addDays = (iso, days) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const pick = (arr, i) => arr[i % arr.length]

async function ensureTeam(name, email, roleKey) {
  // crea (o reutiliza) auth user + perfil
  let id
  const { data: created, error } = await sb.auth.admin.createUser({ email, password: 'Demo1234!', email_confirm: true })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
      id = list.users.find((u) => u.email === email)?.id
    } else throw error
  } else id = created.user.id
  await sb.from('users').upsert({ id, full_name: name, email, role_id: ROLE[roleKey], is_active: true })
  return id
}

async function main() {
  console.log('→ Equipo demo…')
  const closers = [
    await ensureTeam('Laura Gómez', 'laura@demo.closer', 'closer'),
    await ensureTeam('Marcos Ruiz', 'marcos@demo.closer', 'closer'),
  ]
  const setters = [
    await ensureTeam('Ana Torres', 'ana@demo.closer', 'setter'),
    await ensureTeam('David Sanz', 'david@demo.closer', 'setter'),
  ]

  console.log('→ Productos y planes…')
  const { data: prod } = await sb
    .from('products')
    .insert({ name: 'Programa Closer Élite (demo)', is_active: true })
    .select()
    .single()
  const { data: plan } = await sb
    .from('payment_plans')
    .insert({
      product_id: prod.id,
      name: 'Pago único (demo)',
      gross_price: 3000,
      number_of_payments: 1,
      cash_collection_ratio: 1.0,
    })
    .select()
    .single()

  console.log('→ Contactos + atribución…')
  const sources = [
    { source: 'Meta Ads', utm_source: 'facebook', utm_campaign: 'Verano 2026', utm_content: 'video-testimonios' },
    { source: 'YouTube Ads', utm_source: 'youtube', utm_campaign: 'VSL Frío', utm_content: 'anuncio-15s' },
    { source: 'Instagram orgánico', utm_source: 'instagram', utm_campaign: null, utm_content: null },
    { source: 'Referido', utm_source: 'referral', utm_campaign: null, utm_content: null },
  ]
  const contacts = []
  for (let i = 0; i < 16; i++) {
    const { data: c } = await sb
      .from('contacts')
      .insert({
        full_name: `Lead Demo ${i + 1}`,
        email: `lead${i + 1}@demo.closer`,
        notes: '[DEMO]',
      })
      .select()
      .single()
    const s = pick(sources, i)
    await sb.from('contact_attributions').insert({ contact_id: c.id, ...s, is_primary: true })
    contacts.push(c.id)
  }

  console.log('→ Ventas + cobros + agendas…')
  const months = [
    [2026, 3],
    [2026, 4],
    [2026, 5],
    [2026, 6],
  ]
  const grosses = [1500, 3000, 4500, 2000, 6000, 2500, 3500, 5000]
  let n = 0
  for (let mi = 0; mi < months.length; mi++) {
    const [y, m] = months[mi]
    const salesThisMonth = 3 + mi // 3,4,5,6 → crecimiento
    for (let k = 0; k < salesThisMonth; k++) {
      const day = 3 + ((k * 5) % 24)
      const sd = dateStr(y, m, day)
      const gross = pick(grosses, n)
      const contact = pick(contacts, n)
      const closer = pick(closers, n)
      const setter = pick(setters, n + 1)
      const refunded = n % 11 === 5 // alguna devuelta
      const { data: sale } = await sb
        .from('sales')
        .insert({
          contact_id: contact,
          product_id: prod.id,
          payment_plan_id: plan.id,
          sale_date: sd,
          refund_deadline_at: addDays(sd, 14),
          gross_amount: gross,
          closer_id: closer,
          setter_id: setter,
          created_by: ADMIN_ID,
          status: refunded ? 'refunded' : 'active',
          notes: '[DEMO]',
        })
        .select()
        .single()
      if (!refunded) {
        // cobro: 70-100% del bruto
        const cash = n % 3 === 0 ? Math.round(gross * 0.5) : gross
        await sb.from('collections').insert({
          sale_id: sale.id,
          collected_at: `${sd}T12:00:00Z`,
          gross_amount: cash,
          commissionable_amount: cash,
          status: 'collected',
          is_confirmed: true,
        })
      }
      // agenda asociada
      await sb.from('appointments').insert({
        contact_id: contact,
        appointment_datetime: `${sd}T10:00:00Z`,
        status: pick(['show', 'show', 'no_show', 'show'], n),
        setter_id: setter,
        closer_id: closer,
        source: pick(sources, n).source,
      })
      n++
    }
  }

  console.log('→ Objetivos de empresa (junio 2026)…')
  const jun = { period_start: '2026-06-01', period_end: '2026-06-30' }
  await sb.from('targets').insert([
    {
      name: 'Facturación mensual',
      scope_type: 'company',
      metric_key: 'revenue',
      period_type: 'monthly',
      ...jun,
      target_value: 30000,
      is_active: true,
      created_by: ADMIN_ID,
    },
    {
      name: 'Ventas del mes',
      scope_type: 'company',
      metric_key: 'sales_count',
      period_type: 'monthly',
      ...jun,
      target_value: 12,
      is_active: true,
      created_by: ADMIN_ID,
    },
    {
      name: 'Cash collected del mes',
      scope_type: 'company',
      metric_key: 'cash_collected',
      period_type: 'monthly',
      ...jun,
      target_value: 20000,
      is_active: true,
      created_by: ADMIN_ID,
    },
  ])

  console.log(
    `✓ Demo sembrada: ${n} ventas, ${contacts.length} contactos, equipo de ${closers.length + setters.length}.`
  )
}
main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
