import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { businessToday } from '@/lib/dates/business'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'editor']

async function requireRole(sb: ReturnType<typeof svc>, userId: string) {
  const { data: row } = await sb.from('users').select('roles(key)').eq('id', userId).single()
  const role = (row?.roles as { key?: string } | null)?.key
  if (!role || !ALLOWED_ROLES.includes(role)) return { error: 'No autorizado', status: 403 as const }
  return null
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET ?day=YYYY-MM-DD&status=pendiente|aprobado|descartado
// Por defecto: borradores de HOY (o los más recientes si hoy no tiene nada aún).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const sb = svc()
    const roleErr = await requireRole(sb, t.userId)
    if (roleErr) return NextResponse.json({ error: roleErr.error }, { status: roleErr.status })

    const day = req.nextUrl.searchParams.get('day')
    const status = req.nextUrl.searchParams.get('status')

    let query = sb.from('reel_drafts').select('*').eq('tenant_id', t.tenantId).order('created_at', { ascending: false })
    if (day) {
      query = query.eq('draft_day', day)
    } else {
      const today = businessToday()
      query = query.eq('draft_day', today)
    }
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Si no se pidió un día concreto y hoy no tiene nada, cae a los más recientes
    // (por si el cron aún no ha corrido hoy).
    if (!day && (!data || data.length === 0)) {
      let fallback = sb
        .from('reel_drafts')
        .select('*')
        .eq('tenant_id', t.tenantId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (status) fallback = fallback.eq('status', status)
      const { data: recent, error: recentErr } = await fallback
      if (recentErr) return NextResponse.json({ error: recentErr.message }, { status: 500 })
      return NextResponse.json({ drafts: recent || [] })
    }

    return NextResponse.json({ drafts: data || [] })
  } catch (err) {
    console.error('[api/reels GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
