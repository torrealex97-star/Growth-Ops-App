import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { fireCourseAccessWebhook, onboardingWebhookConfigured } from '@/lib/ghl'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'csm']

// Concede/revoca el acceso al curso desde la plataforma (los cursos viven en GHL). Dispara el
// webhook saliente que ya usa el onboarding (misma automatización, evento distinto) para que GHL
// ejecute la acción real, y registra en `sales` cuándo se pidió desde aquí.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = await req.json()
    const { saleId, action } = body as { saleId?: string; action?: 'grant' | 'revoke' }
    if (!saleId || (action !== 'grant' && action !== 'revoke')) {
      return NextResponse.json({ error: 'Falta saleId o action inválida' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const role = t.role || ''
    if (!t.isSuperAdmin && !ALLOWED_ROLES.includes(role))
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const { data: sale } = await sb
      .from('sales')
      .select('id, contact_id, products(name), contacts(email, phone)')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    const contact = sale.contacts as unknown as { email: string | null; phone: string | null } | null
    const product = sale.products as unknown as { name: string } | null

    const webhookResult = await fireCourseAccessWebhook(action, {
      saleId,
      contactId: sale.contact_id,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      product: product?.name ?? '',
    })

    const now = new Date().toISOString()
    const patch =
      action === 'grant'
        ? { course_access_granted_at: now, course_access_revoked_at: null }
        : { course_access_revoked_at: now }
    const { data: updated, error } = await sb
      .from('sales')
      .update(patch)
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'sale',
      entity_id: saleId,
      action: `course_access_${action}`,
      new_values: { ...patch, webhookResult },
    })

    return NextResponse.json({
      ok: true,
      sale: updated,
      webhookConfigured: onboardingWebhookConfigured(),
      webhookResult,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
