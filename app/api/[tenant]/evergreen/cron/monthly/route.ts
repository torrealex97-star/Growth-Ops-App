import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Genera los gastos mensuales automáticos: sueldos fijos del equipo + gastos recurrentes.
// Idempotente por (auto_source, period) — se puede llamar varias veces el mismo mes.
// Auth: header Bearer CRON_SECRET (Vercel Cron) o sesión de admin/director (botón manual).
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  try {
    const cookieStore = await cookies()
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return false
    const { data } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (data?.roles as { key?: string } | null)?.key
    return role === 'admin' || role === 'director'
  } catch { return false }
}

async function run() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const now = new Date()
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const firstOfMonth = `${period}-01`
  const rows: Record<string, unknown>[] = []
  // Sincronización de importes para las filas ya existentes del periodo (auto_source, period).
  // Cada entrada: { auto_source, fields } → se actualiza sin tocar `status` (respeta pagos ya marcados).
  const syncs: { auto_source: string; fields: Record<string, unknown> }[] = []

  // 1) Sueldos fijos del equipo (users.base_salary) + comisión devengada, autocalculado.
  // `liquidation_month` de una comisión es el día 1 del mes en que se LIQUIDA (mes siguiente al
  // del cobro, ver getLiquidationMonth) — es decir, las comisiones con liquidation_month = mes
  // actual son justo las que tocan pagar ahora junto al fijo. Se excluyen las canceladas; el resto
  // (pending/approved/liquidated) sí se computa porque de otro modo el sueldo del día 1 nunca
  // incluiría comisión aún no aprobada por el cron de aprobación automática.
  const { data: team } = await sb.from('users').select('id, full_name, base_salary').eq('is_active', true)
  const { data: periodCommissions } = await sb
    .from('commissions')
    .select('user_id, commission_amount, direction')
    .eq('liquidation_month', firstOfMonth)
    .neq('status', 'cancelled')
  const commissionByUser = new Map<string, number>()
  for (const c of periodCommissions || []) {
    const signed = c.direction === 'negative' ? -Number(c.commission_amount) : Number(c.commission_amount)
    commissionByUser.set(c.user_id, (commissionByUser.get(c.user_id) ?? 0) + signed)
  }
  for (const u of team || []) {
    const base = Number(u.base_salary) || 0
    // Solo se autocalcula la comisión para quien YA tiene fijo (fijo + comisión); a quien cobra
    // 100% a comisión no se le crea un gasto nuevo aquí — eso sigue su flujo de liquidación aparte.
    if (base <= 0) continue
    const commission = Math.max(commissionByUser.get(u.id) ?? 0, 0)
    const total = base + commission
    if (total > 0) {
      const auto_source = `salary:${u.id}`
      const concept = commission > 0 ? `Sueldo ${u.full_name} (fijo + comisión)` : `Sueldo ${u.full_name}`
      const fields = { concept, amount: total }
      rows.push({
        ...fields, category: 'sueldos',
        expense_date: firstOfMonth, recurring: true, frequency: 'mensual', status: 'pendiente',
        person_id: u.id, auto_source, period,
      })
      syncs.push({ auto_source, fields })
    }
  }

  // 2) Gastos recurrentes mensuales (plantillas creadas a mano: recurring=true, frequency='mensual', sin auto_source)
  const { data: templates } = await sb.from('expenses')
    .select('id, concept, category, subcategory, amount, counterparty, person_id')
    .eq('recurring', true).eq('frequency', 'mensual').is('auto_source', null)
  for (const t of templates || []) {
    const auto_source = `recurring:${t.id}`
    const fields = { concept: t.concept, category: t.category, subcategory: t.subcategory, amount: t.amount, counterparty: t.counterparty, person_id: t.person_id }
    rows.push({
      ...fields, expense_date: firstOfMonth,
      recurring: true, frequency: 'mensual', status: 'pendiente',
      auto_source, period,
    })
    syncs.push({ auto_source, fields })
  }

  let inserted = 0
  if (rows.length) {
    // upsert con ignoreDuplicates para respetar el índice único (auto_source, period)
    const { data, error } = await sb.from('expenses')
      .upsert(rows, { onConflict: 'auto_source,period', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(error.message)
    inserted = data?.length ?? 0
  }

  // Sincroniza los importes/conceptos de las filas ya existentes del periodo: si el sueldo base
  // o el importe de una plantilla cambió desde que se generó el gasto, aquí se pone al día.
  // No se toca `status`, así que un gasto ya marcado como pagado conserva su estado.
  let synced = 0
  for (const s of syncs) {
    const { data, error } = await sb.from('expenses')
      .update(s.fields)
      .eq('auto_source', s.auto_source).eq('period', period)
      .select('id')
    if (error) throw new Error(error.message)
    synced += data?.length ?? 0
  }

  return { period, candidates: rows.length, inserted, synced }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await run()) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// Vercel Cron usa GET
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await run()) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
