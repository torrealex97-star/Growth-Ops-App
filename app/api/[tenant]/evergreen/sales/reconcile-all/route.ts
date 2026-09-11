import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'

export const runtime = 'nodejs'
export const maxDuration = 60

// Reparación masiva: reconcilia las comisiones de TODAS las ventas a partir de sus cobros reales,
// para cuadrar la contabilidad (corrige cobros que no generaron comisión y tramos desalineados).
// Idempotente. Acceso: sesión admin/director O cabecera Authorization: Bearer <CRON_SECRET>.
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')
    const viaCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

    if (!viaCron) {
      const cookieStore = await cookies()
      const authed = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
      )
      const { data: { user } } = await authed.auth.getUser()
      if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
      const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
      const role = (urow?.roles as { key?: string } | null)?.key
      if (!['admin', 'director'].includes(role || '')) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
      }
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: sales } = await sb.from('sales').select('id')
    const ids = (sales ?? []).map((s: { id: string }) => s.id)

    let created = 0
    let deleted = 0
    const perSale: { saleId: string; created: number; deleted: number }[] = []
    for (const id of ids) {
      const r = await reconcileSaleCommissions(sb, id)
      created += r.created
      deleted += r.deleted
      if (r.created || r.deleted) perSale.push({ saleId: id, created: r.created, deleted: r.deleted })
    }

    return NextResponse.json({ ok: true, sales: ids.length, created, deleted, perSale })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
