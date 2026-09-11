import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const VALID_PERIODS = ['daily', 'weekly']

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Fecha/semana de HOY en horario de España (mercado principal del equipo), para que el corte de
// día/semana sea el mismo para todos independientemente del huso horario del navegador.
function madridNow(): Date {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return new Date(`${s}T00:00:00Z`)
}

function dailyKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Clave de semana ISO (YYYY-Www): mismo criterio que usan los calendarios de equipo en España.
function weeklyKey(d: Date): string {
  const date = new Date(d.getTime())
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function periodKeyFor(periodType: string, now: Date): string {
  return periodType === 'weekly' ? weeklyKey(now) : dailyKey(now)
}

// GET — mis notas del día/semana actuales + el muro compartido reciente del equipo.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const now = madridNow()
  const dKey = dailyKey(now)
  const wKey = weeklyKey(now)
  const sb = serviceClient()

  const [mineRes, wallRes] = await Promise.all([
    sb
      .from('positive_notes')
      .select('*')
      .eq('user_id', t.userId)
      .eq('tenant_id', t.tenantId)
      .in('period_key', [dKey, wKey]),
    sb
      .from('positive_notes')
      .select('id, period_type, content, created_at, users(full_name)')
      .eq('is_shared', true)
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (mineRes.error) return NextResponse.json({ error: mineRes.error.message }, { status: 500 })
  if (wallRes.error) return NextResponse.json({ error: wallRes.error.message }, { status: 500 })

  const mine = mineRes.data ?? []
  const daily = mine.find((n) => n.period_type === 'daily' && n.period_key === dKey) ?? null
  const weekly = mine.find((n) => n.period_type === 'weekly' && n.period_key === wKey) ?? null

  return NextResponse.json({ daily, weekly, wall: wallRes.data ?? [] })
}

// POST — crea/actualiza (upsert) la nota del periodo actual del usuario logueado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const body = await req.json()
  const periodType = VALID_PERIODS.includes(body.period_type) ? body.period_type : null
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const isShared = body.is_shared === true

  if (!periodType) return NextResponse.json({ error: 'period_type inválido' }, { status: 400 })
  if (!content) return NextResponse.json({ error: 'La nota no puede estar vacía' }, { status: 400 })

  const periodKey = periodKeyFor(periodType, madridNow())
  const sb = serviceClient()
  const { data, error } = await sb
    .from('positive_notes')
    .upsert(
      {
        user_id: t.userId,
        tenant_id: t.tenantId,
        period_type: periodType,
        period_key: periodKey,
        content: content.slice(0, 2000),
        is_shared: isShared,
      },
      { onConflict: 'user_id,period_type,period_key' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data })
}
