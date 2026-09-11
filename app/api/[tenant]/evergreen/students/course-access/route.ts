import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { fireCourseAccessWebhook, onboardingWebhookConfigured } from '@/lib/ghl'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'csm']

// Concede/revoca el acceso al curso desde la plataforma (los cursos viven en GHL). Dispara el
// webhook saliente que ya usa el onboarding (misma automatización, evento distinto) para que GHL
// ejecute la acción real, y registra en `sales` cuándo se pidió desde aquí.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { saleId, action } = body as { saleId?: string; action?: 'grant' | 'revoke' }
    if (!saleId || (action !== 'grant' && action !== 'revoke')) {
      return NextResponse.json({ error: 'Falta saleId o action inválida' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: sale } = await sb
      .from('sales')
      .select('id, contact_id, products(name), contacts(email, phone)')
      .eq('id', saleId)
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
    const patch = action === 'grant' ? { course_access_granted_at: now, course_access_revoked_at: null } : { course_access_revoked_at: now }
    const { data: updated, error } = await sb.from('sales').update(patch).eq('id', saleId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      actor_user_id: user.id,
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
