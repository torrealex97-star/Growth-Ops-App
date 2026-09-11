import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import type { SuggestionStatus, SuggestionTeamStat } from '@/lib/types/database'

export const runtime = 'nodejs'

const STATUS_ORDER: SuggestionStatus[] = [
  'nueva', 'en_revision', 'planificada', 'en_progreso', 'resuelta', 'descartada',
]

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function emptyByStatus(): Record<SuggestionStatus, number> {
  return { nueva: 0, en_revision: 0, planificada: 0, en_progreso: 0, resuelta: 0, descartada: 0 }
}

// GET — sistema Kaizen: reconocimiento de equipo. Cualquier usuario autenticado
// puede ver el ranking (solo contadores agregados por persona, nunca el
// contenido de las sugerencias de otros), para que sea un reconocimiento
// social visible a todo el equipo y no solo a admin/director.
export async function GET() {
  try {
    const authed = await createServerClient()
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const sb = serviceClient()
    const { data, error } = await sb
      .from('suggestions')
      .select('user_id, status, resolved_at, users(full_name, email)')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const byUser = new Map<string, SuggestionTeamStat>()
    for (const row of data ?? []) {
      const userId = row.user_id as string | null
      if (!userId) continue // sugerencias con autor eliminado (user_id NULL) no cuentan para el ranking

      const usersRaw = row.users as { full_name: string | null; email: string | null }[] | { full_name: string | null; email: string | null } | null
      const users = Array.isArray(usersRaw) ? usersRaw[0] ?? null : usersRaw
      let stat = byUser.get(userId)
      if (!stat) {
        stat = {
          user_id: userId,
          full_name: users?.full_name ?? null,
          email: users?.email ?? null,
          total: 0,
          by_status: emptyByStatus(),
          resolved_total: 0,
          resolved_this_month: 0,
        }
        byUser.set(userId, stat)
      }

      const status = row.status as SuggestionStatus
      stat.total += 1
      if (status in stat.by_status) stat.by_status[status] += 1

      if (status === 'resuelta') {
        stat.resolved_total += 1
        const resolvedAt = row.resolved_at as string | null
        if (resolvedAt) {
          const d = new Date(resolvedAt)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (key === monthKey) stat.resolved_this_month += 1
        }
      }
    }

    const stats = Array.from(byUser.values()).sort((a, b) => {
      if (b.resolved_total !== a.resolved_total) return b.resolved_total - a.resolved_total
      return b.total - a.total
    })

    return NextResponse.json({ stats, statusOrder: STATUS_ORDER })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
