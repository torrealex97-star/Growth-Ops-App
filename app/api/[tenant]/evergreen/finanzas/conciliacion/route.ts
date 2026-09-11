import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { buildConciliacion } from '@/lib/finance/reconciliation'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'cobros']

async function authorize(tenant: string) {
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: user } = await sb.from('users').select('roles(key)').eq('id', auth.userId).single()
  const role = (user?.roles as { key?: string } | null)?.key
  if (!ALLOWED_ROLES.includes(role || '')) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { ...auth, sb }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await authorize(tenant)
  if ('error' in auth) return auth.error

  const cfg = await getTenantConfigWithFallback(auth.tenantId)
  try {
    const result = await buildConciliacion(auth.sb, auth.tenantId, {
      stripeSecretKey: cfg.STRIPE_SECRET_KEY || null,
      stripeAccountId: cfg.STRIPE_ACCOUNT_ID || null,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudo calcular la conciliación.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await authorize(tenant)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({}))
  const { platform, reference, amount, transacted_at, notes } = body || {}
  if (!['transferencia', 'bizum', 'paypal', 'otro'].includes(platform)) {
    return NextResponse.json({ error: 'Plataforma inválida' }, { status: 400 })
  }
  if (!amount || Number.isNaN(Number(amount)) || !transacted_at) {
    return NextResponse.json({ error: 'Importe y fecha son obligatorios' }, { status: 400 })
  }

  const { data, error } = await auth.sb
    .from('manual_platform_records')
    .insert({
      tenant_id: auth.tenantId,
      platform,
      reference: reference || null,
      amount: Number(amount),
      transacted_at,
      notes: notes || null,
      created_by: auth.userId,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, record: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await authorize(tenant)
  if ('error' in auth) return auth.error

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const { error } = await auth.sb.from('manual_platform_records').delete().eq('id', id).eq('tenant_id', auth.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
