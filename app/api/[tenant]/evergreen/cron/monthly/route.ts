import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Genera los gastos mensuales automáticos: sueldos fijos del equipo + gastos recurrentes.
// Idempotente por (auto_source, period) — se puede llamar varias veces el mismo mes.
//
// Dos superficies con alcances DELIBERADAMENTE distintos (mismo patrón que cron/analyze-calls):
//   GET  → proceso de plataforma (Vercel Cron). SOLO Bearer CRON_SECRET. Recorre todas las
//          subcuentas activas. Nunca acepta sesión.
//   POST → botón manual de la UI. Sesión + requireTenant(slug de la URL) + rol admin/director de
//          ESA subcuenta. Genera ÚNICAMENTE la subcuenta de la URL y su respuesta no menciona
//          ninguna otra.
//
// Antes bastaba una sesión con rol global admin/director para que POST recorriera TODAS las
// subcuentas con service_role, escribiera gastos en cada una y devolviera los slugs de todas. El
// rol además se leía de `users.roles`, que es global y no dice de qué subcuenta eres miembro.

// Corre la generación de gastos mensuales para UNA subcuenta (todas las lecturas/escrituras
// van filtradas/estampadas por tenant_id).
async function runForTenant(sb: SupabaseClient, tenantId: string) {
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
  // `users` no tiene tenant_id (identidad compartida entre subcuentas): el equipo de ESTA
  // subcuenta se acota vía tenant_members, para no duplicar el gasto de sueldo del mismo
  // usuario en cada subcuenta a la que pertenezca (y no violar el índice único
  // (auto_source, period) de `expenses` al recorrer varias subcuentas en el mismo cron).
  const { data: memberIds } = await sb.from('tenant_members').select('user_id').eq('tenant_id', tenantId)
  const memberIdSet = new Set((memberIds || []).map((m: { user_id: string }) => m.user_id))
  const { data: teamAll } = await sb.from('users').select('id, full_name, base_salary').eq('is_active', true)
  const team = (teamAll || []).filter((u: { id: string }) => memberIdSet.has(u.id))
  // Paginado: de aquí sale el gasto de "sueldo + comisión" que se escribe en `expenses`. Con más
  // de 1.000 comisiones en el mes, PostgREST recortaba la lista sin avisar y el gasto del mes salía
  // más bajo que el real — un error contable con toda la pinta de dato bueno.
  const { rows: periodCommissions } = await fetchAllRows<{
    user_id: string
    commission_amount: number | string
    direction: string
  }>(() =>
    sb
      .from('commissions')
      .select('user_id, commission_amount, direction')
      .eq('tenant_id', tenantId)
      .eq('liquidation_month', firstOfMonth)
      .neq('status', 'cancelled')
  )
  const commissionByUser = new Map<string, number>()
  for (const c of periodCommissions) {
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
        tenant_id: tenantId,
        ...fields,
        category: 'sueldos',
        expense_date: firstOfMonth,
        recurring: true,
        frequency: 'mensual',
        status: 'pendiente',
        person_id: u.id,
        auto_source,
        period,
      })
      syncs.push({ auto_source, fields })
    }
  }

  // 2) Gastos recurrentes mensuales (plantillas creadas a mano: recurring=true, frequency='mensual', sin auto_source)
  const { data: templates } = await sb
    .from('expenses')
    .select('id, concept, category, subcategory, amount, counterparty, person_id')
    .eq('tenant_id', tenantId)
    .eq('recurring', true)
    .eq('frequency', 'mensual')
    .is('auto_source', null)
  for (const t of templates || []) {
    const auto_source = `recurring:${t.id}`
    const fields = {
      concept: t.concept,
      category: t.category,
      subcategory: t.subcategory,
      amount: t.amount,
      counterparty: t.counterparty,
      person_id: t.person_id,
    }
    rows.push({
      tenant_id: tenantId,
      ...fields,
      expense_date: firstOfMonth,
      recurring: true,
      frequency: 'mensual',
      status: 'pendiente',
      auto_source,
      period,
    })
    syncs.push({ auto_source, fields })
  }

  let inserted = 0
  if (rows.length) {
    // upsert con ignoreDuplicates para respetar el índice único (auto_source, period)
    const { data, error } = await sb
      .from('expenses')
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
    const { data, error } = await sb
      .from('expenses')
      .update(s.fields)
      .eq('auto_source', s.auto_source)
      .eq('period', period)
      .eq('tenant_id', tenantId)
      .select('id')
    if (error) throw new Error(error.message)
    synced += data?.length ?? 0
  }

  return { period, candidates: rows.length, inserted, synced }
}

// Vercel Cron pega a una única URL estática, así que este handler recorre TODAS las
// subcuentas activas y corre la generación de gastos mensuales una vez por cada una
// (filtrando/estampando tenant_id en cada lectura/escritura de runForTenant).
async function run() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
  if (tenantsErr) throw new Error(tenantsErr.message)

  const perTenant: Record<string, { period: string; candidates: number; inserted: number; synced: number }> = {}
  for (const tn of tenants || []) {
    perTenant[tn.slug] = await runForTenant(sb, tn.id)
  }
  return { tenants: perTenant }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await run()) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }

  // Alcance: exclusivamente la subcuenta de la URL, ya validada por requireTenant. El tenant NUNCA
  // sale del body. La respuesta es plana y solo habla de esta subcuenta — que es además lo que los
  // botones de la UI leen (`period`, `inserted`), y con la forma anterior ({ tenants: { slug } })
  // mostraban "Generados undefined gastos de undefined".
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    return NextResponse.json({ ok: true, ...(await runForTenant(sb, session.tenantId)) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
