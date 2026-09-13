import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { classifyForBackfill, summarizeBackfill, type BackfillRow } from '@/lib/finance/stripeBackfill'
import type { StripeIntent } from '@/lib/finance/stripeReconciliation'

export const runtime = 'nodejs'
export const maxDuration = 60

// INFORME de backfill de Stripe. **Solo GET, y no escribe nada** — ni siquiera con un parámetro.
//
// No es prudencia de más: `sales.product_id` y `sales.payment_plan_id` son NOT NULL, y un pago de
// Stripe no dice a qué producto interno corresponde ni cuál es la política de reembolso. Registrar
// ventas automáticamente exigiría elegir un producto, o sea inventar datos financieros. Este informe
// dice qué falta y qué decisión hace falta en cada caso; la toma una persona desde Ventas.

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }

  const sp = new URL(req.url).searchParams
  const to = sp.get('to') || new Date().toISOString().slice(0, 10)
  const from = sp.get('from') || new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Las fechas deben ir en formato YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) return NextResponse.json({ error: 'La fecha de inicio es posterior a la de fin' }, { status: 400 })

  const cfg = await getTenantConfigWithFallback(session.tenantId, true)
  const key = cfg.STRIPE_SECRET_KEY
  if (!key) {
    return NextResponse.json({ error: 'Falta la Secret Key de Stripe en Integraciones' }, { status: 400 })
  }

  const sb: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Referencias de pago ya registradas, para no proponer lo que ya está.
  const { data: collections, error: colError } = await sb
    .from('collections')
    .select('payment_reference')
    .eq('tenant_id', session.tenantId)
    .not('payment_reference', 'is', null)
    .limit(10000)
  if (colError) return NextResponse.json({ error: colError.message }, { status: 500 })
  const knownReferences = new Set(
    (collections ?? []).map((c) => (c as { payment_reference: string }).payment_reference).filter(Boolean)
  )

  // Contactos por email, para poder identificar al cliente sin inventarlo.
  const { data: contacts, error: contError } = await sb
    .from('contacts')
    .select('id,email')
    .eq('tenant_id', session.tenantId)
    .not('email', 'is', null)
    .limit(10000)
  if (contError) return NextResponse.json({ error: contError.message }, { status: 500 })
  const contactsByEmail = new Map<string, string>()
  for (const c of contacts ?? []) {
    const row = c as { id: string; email: string }
    const email = row.email.trim().toLowerCase()
    // El primero gana: si hubiera dos contactos con el mismo email, elegir "el correcto" sería
    // adivinar. La deduplicación de contactos es otro problema, con su propia pantalla.
    if (email && !contactsByEmail.has(email)) contactsByEmail.set(email, row.id)
  }

  const gte = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000)
  const lte = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000)

  const rows: BackfillRow[] = []
  let startingAfter: string | undefined
  let paginas = 0
  // Presupuesto de tiempo: un año de pagos puede ser mucho. Antes parar e informar de que quedan.
  const deadline = Date.now() + 45_000

  while (paginas < 40 && Date.now() < deadline) {
    const query = new URLSearchParams({ limit: '100' })
    query.set('created[gte]', String(gte))
    query.set('created[lte]', String(lte))
    query.append('expand[]', 'data.latest_charge')
    if (startingAfter) query.set('starting_after', startingAfter)

    const r = await fetch(`https://api.stripe.com/v1/payment_intents?${query}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...(cfg.STRIPE_ACCOUNT_ID ? { 'Stripe-Account': cfg.STRIPE_ACCOUNT_ID } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const j = (await r.json().catch(() => ({}))) as {
      data?: StripeIntent[]
      has_more?: boolean
      error?: { message?: string }
    }
    if (!r.ok) {
      return NextResponse.json({ error: j.error?.message || `Stripe respondió ${r.status}` }, { status: 400 })
    }
    const intents = j.data ?? []
    for (const intent of intents) rows.push(classifyForBackfill(intent, { knownReferences, contactsByEmail }))

    paginas++
    if (!j.has_more || intents.length === 0) {
      startingAfter = undefined
      break
    }
    startingAfter = intents[intents.length - 1].id
  }

  const resumen = summarizeBackfill(rows)
  return NextResponse.json({
    ok: true,
    solo_lectura: true,
    rango: { from, to },
    paginas,
    quedan_por_revisar: !!startingAfter,
    resumen,
    // Solo lo que requiere una decisión: mandar 5.000 filas de "ya registrado" no ayuda a nadie.
    pendientes: rows.filter((r) => r.verdict !== 'ya_registrado').slice(0, 500),
  })
}
