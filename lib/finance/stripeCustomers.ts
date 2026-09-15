// Completa la base de clientes/alumnos con lo que sabe Stripe: quién ha pagado alguna vez
// (cliente), quién paga mensualmente (activo_mensual), quién está en mora (moroso) o canceló
// (cancelado). Se vincula por email a `contacts` cuando hay coincidencia; si no hay contacto
// interno, el cliente de Stripe queda igualmente cacheado (sin contact_id) — dato útil para
// detectar altas de pago que no llegaron a registrarse en la app.
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeList } from '@/lib/stripe/client'

type StripeCustomerStatus = 'cliente' | 'activo_mensual' | 'moroso' | 'cancelado'

export type StripeCustomerRow = {
  stripeCustomerId: string
  email: string | null
  name: string | null
  status: StripeCustomerStatus
  subscriptionId: string | null
  currentPeriodEnd: string | null
  contactId: string | null
}

type StripeSubscription = {
  id: string
  status: string
  current_period_end: number
  customer: string | { id: string; email?: string | null; name?: string | null } | null
}

type StripeCharge = {
  paid: boolean
  customer: string | { id: string; email?: string | null; name?: string | null } | null
  billing_details?: { email?: string | null; name?: string | null }
}

function customerId(c: StripeSubscription['customer']): string | null {
  if (!c) return null
  return typeof c === 'string' ? c : c.id
}

function customerInfo(c: StripeSubscription['customer']): { email: string | null; name: string | null } {
  if (!c || typeof c === 'string') return { email: null, name: null }
  return { email: c.email ?? null, name: c.name ?? null }
}

// Prioridad de estado cuando un mismo cliente aparece en varias suscripciones/cargos:
// moroso > activo_mensual > cancelado > cliente (un impago pesa más que una suscripción sana).
const STATUS_PRIORITY: Record<StripeCustomerStatus, number> = {
  moroso: 3,
  activo_mensual: 2,
  cancelado: 1,
  cliente: 0,
}

function statusFromSubscription(status: string): StripeCustomerStatus | null {
  if (status === 'active' || status === 'trialing') return 'activo_mensual'
  if (status === 'past_due' || status === 'unpaid') return 'moroso'
  if (status === 'canceled' || status === 'incomplete_expired') return 'cancelado'
  return null // 'incomplete' u otros estados transitorios: no aportan clasificación fiable
}

export async function syncStripeCustomers(
  sb: SupabaseClient,
  tenantId: string,
  stripeSecretKey: string,
  stripeAccountId?: string | null
): Promise<{ rows: StripeCustomerRow[]; matched: number; unmatched: number; truncated: boolean }> {
  const auth = { secretKey: stripeSecretKey, accountId: stripeAccountId }
  // Presupuesto de tiempo compartido por las dos listas: la lambda tiene 60 s y hay que dejar margen
  // para escribir en la base de datos.
  const deadline = Date.now() + 40_000

  const subsQuery = new URLSearchParams({ status: 'all', limit: '100' })
  subsQuery.append('expand[]', 'data.customer')
  const chargesQuery = new URLSearchParams({ limit: '100' })
  chargesQuery.append('expand[]', 'data.customer')

  // PAGINADO. Antes se pedía una sola página de 100: con más de 100 suscripciones o cargos, la base
  // de clientes salía incompleta sin ningún aviso, y quien la mirara concluiría que esos alumnos no
  // habían pagado nunca.
  const [subs, charges] = await Promise.all([
    stripeList<StripeSubscription & { id: string }>('subscriptions', subsQuery, auth, { deadline }),
    stripeList<StripeCharge & { id: string }>('charges', chargesQuery, auth, { deadline }),
  ])
  const truncated = subs.truncated || charges.truncated

  const byCustomer = new Map<
    string,
    {
      email: string | null
      name: string | null
      status: StripeCustomerStatus
      subscriptionId: string | null
      currentPeriodEnd: string | null
    }
  >()

  const applyStatus = (
    id: string,
    info: { email: string | null; name: string | null },
    status: StripeCustomerStatus,
    subscriptionId: string | null,
    currentPeriodEnd: string | null
  ) => {
    const existing = byCustomer.get(id)
    if (!existing || STATUS_PRIORITY[status] > STATUS_PRIORITY[existing.status]) {
      byCustomer.set(id, {
        email: info.email ?? existing?.email ?? null,
        name: info.name ?? existing?.name ?? null,
        status,
        subscriptionId,
        currentPeriodEnd,
      })
    } else if (existing && !existing.email && info.email) {
      existing.email = info.email
      existing.name = existing.name ?? info.name
    }
  }

  for (const sub of subs.items) {
    const id = customerId(sub.customer)
    const status = statusFromSubscription(sub.status)
    if (!id || !status) continue
    applyStatus(
      id,
      customerInfo(sub.customer),
      status,
      sub.id,
      sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
    )
  }
  for (const charge of charges.items) {
    if (!charge.paid) continue
    const id = customerId(charge.customer)
    if (!id) continue
    const info =
      typeof charge.customer === 'object' && charge.customer
        ? {
            email: charge.customer.email ?? charge.billing_details?.email ?? null,
            name: charge.customer.name ?? charge.billing_details?.name ?? null,
          }
        : { email: charge.billing_details?.email ?? null, name: charge.billing_details?.name ?? null }
    applyStatus(id, info, 'cliente', null, null)
  }

  const emails = new Set(
    Array.from(byCustomer.values())
      .map((c) => c.email?.trim().toLowerCase())
      .filter((e): e is string => !!e)
  )
  const contactByEmail = new Map<string, string>()
  if (emails.size > 0) {
    // `.limit(10000)` explícito: sin él PostgREST devuelve como mucho 1.000 filas y el resto de los
    // contactos simplemente no existiría para el cruce — los clientes de Stripe saldrían "sin
    // contacto" por un tope de la API, no porque falte el contacto.
    const { data: contacts, error } = await sb
      .from('contacts')
      .select('id,email')
      .eq('tenant_id', tenantId)
      .not('email', 'is', null)
      .limit(10000)
    if (error) throw new Error(error.message)
    for (const c of contacts ?? []) {
      const email = (c as { email: string | null }).email?.trim().toLowerCase()
      if (email && emails.has(email) && !contactByEmail.has(email)) contactByEmail.set(email, (c as { id: string }).id)
    }
  }

  const rows: StripeCustomerRow[] = Array.from(byCustomer.entries()).map(([stripeCustomerId, c]) => ({
    stripeCustomerId,
    email: c.email,
    name: c.name,
    status: c.status,
    subscriptionId: c.subscriptionId,
    currentPeriodEnd: c.currentPeriodEnd,
    contactId: (c.email && contactByEmail.get(c.email.trim().toLowerCase())) || null,
  }))

  if (rows.length > 0) {
    const { error } = await sb.from('stripe_customers').upsert(
      rows.map((r) => ({
        tenant_id: tenantId,
        contact_id: r.contactId,
        stripe_customer_id: r.stripeCustomerId,
        email: r.email,
        name: r.name,
        status: r.status,
        subscription_id: r.subscriptionId,
        current_period_end: r.currentPeriodEnd,
        last_synced_at: new Date().toISOString(),
      })),
      { onConflict: 'tenant_id,stripe_customer_id' }
    )
    if (error) throw new Error(error.message)
  }

  const matched = rows.filter((r) => r.contactId).length
  return { rows, matched, unmatched: rows.length - matched, truncated }
}
