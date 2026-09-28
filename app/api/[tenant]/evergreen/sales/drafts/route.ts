import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// VENTAS BORRADOR — pagos de Stripe identificados por contacto, sugeridos por
// lib/finance/stripeSaleDrafts.ts, pendientes de que un closer/admin los apruebe o rechace.
// Ver la migración 20260928120000_sale_drafts.sql para el porqué de esta tabla.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireFinanceAdmin(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session
  // Aprobar un borrador escribe ventas y cobros: mismo permiso que el registro manual y el backfill.
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return { error: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }) }
  }
  return session
}

// GET — borradores pendientes + catálogo de productos/planes para poder corregir la sugerencia.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const sb = serviceClient()
  const [drafts, contacts, products, plans] = await Promise.all([
    sb
      .from('sale_drafts')
      .select(
        'id, amount, currency, email, occurred_at, contact_id, suggested_product_id, suggested_payment_plan_id, existing_sale_id, reason, stripe_price_id, payment_reference, created_at'
      )
      .eq('tenant_id', session.tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('contacts').select('id, full_name, email').eq('tenant_id', session.tenantId).limit(10000),
    sb.from('products').select('id, name').eq('tenant_id', session.tenantId).order('name'),
    sb
      .from('payment_plans')
      .select('id, name, product_id, method, cash_collection_ratio, gross_price')
      .eq('tenant_id', session.tenantId)
      .eq('is_active', true)
      .order('name'),
  ])
  if (drafts.error) return NextResponse.json({ error: drafts.error.message }, { status: 500 })
  if (contacts.error) return NextResponse.json({ error: contacts.error.message }, { status: 500 })
  if (products.error) return NextResponse.json({ error: products.error.message }, { status: 500 })
  if (plans.error) return NextResponse.json({ error: plans.error.message }, { status: 500 })

  const contactById = new Map((contacts.data ?? []).map((c) => [c.id as string, c]))
  const filas = (drafts.data ?? []).map((d) => ({
    ...d,
    contact: d.contact_id ? (contactById.get(d.contact_id as string) ?? null) : null,
  }))

  return NextResponse.json({
    drafts: filas,
    products: products.data ?? [],
    plans: plans.data ?? [],
  })
}
