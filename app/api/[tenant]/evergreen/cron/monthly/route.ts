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
//   GET  → proceso de plataforma (GitHub Actions). SOLO Bearer CRON_SECRET. Recorre todas las
//          subcuentas activas. Nunca acepta sesión.
//   POST → botón manual de la UI. Sesión + requireTenant(slug de la URL) + rol admin/director de
//          ESA subcuenta. Genera ÚNICAMENTE la subcuenta de la URL y su respuesta no menciona
//          ninguna otra.
//
// Antes bastaba una sesión con rol global admin/director para que POST recorriera TODAS las
// subcuentas con service_role, escribiera gastos en cada una y devolviera los slugs de todas. El
// rol además se leía de `users.roles`, que es global y no dice de qué subcuenta eres miembro.
//
// PRESUPUESTO DE TIEMPO: maxDuration=60 NO es presupuesto de trabajo (calendly-ghl murió con 504
// gastando 35+25=60 s exactos: antes del primer fetch ya se van cold start, middleware y candados).
// El run se autolimita a 45 s repartidos entre subcuentas y un corte por presupuesto NO es un
// fallo: el upsert es idempotente por (auto_source, period) y la llamada siguiente continúa. Lo
// que SÍ es un fallo y se reporta como tal (HTTP 5xx / `error` por subcuenta) es una escritura o
// lectura que no se pudo aplicar: supabase-js no lanza, devuelve `{ error }`, y tragarlo aquí
// significaba "sueldos no generados este mes" con toda la pinta de un mes sin equipo.

const TIME_BUDGET_MS = 45_000 // deja margen sobre maxDuration=60 para responder siempre

// supabase-js no lanza en fallo: devuelve `{ error }`. Un fallo de lectura tratado como "lista
// vacía" produce un gasto de sueldo AUSENTE con respuesta `ok` — el caso exacto que esta ruta
// no puede permitirse (mismo criterio que #231/#236: fail ruidoso, nunca silencio contable).
function errorDe(fallback: string, err: { message: string } | null): Error {
  return new Error(err?.message ? `${fallback}: ${err.message}` : fallback)
}

type TenantResult = {
  period: string
  candidates: number
  inserted: number
  synced: number
  /** true si se agotó el presupuesto de tiempo: quedan gastos por generar hasta la pasada siguiente. */
  cortado?: boolean
}

// Corre la generación de gastos mensuales para UNA subcuenta (todas las lecturas/escrituras
// van filtradas/estampadas por tenant_id). `deadline` acota el trabajo: al agotarse se corta
// declarándolo, sin dar por generada una lista que no se recorrió.
async function runForTenant(sb: SupabaseClient, tenantId: string, deadline: number): Promise<TenantResult> {
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
  const { data: memberIds, error: membersErr } = await sb
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
  if (membersErr) throw errorDe('No se pudo leer el equipo de la subcuenta', membersErr)
  const memberIdSet = new Set((memberIds || []).map((m: { user_id: string }) => m.user_id))
  const { data: teamAll, error: teamErr } = await sb
    .from('users')
    .select('id, full_name, base_salary')
    .eq('is_active', true)
  if (teamErr) throw errorDe('No se pudo leer el equipo activo', teamErr)
  const team = (teamAll || []).filter((u: { id: string }) => memberIdSet.has(u.id))
  // Paginado: de aquí sale el gasto de "sueldo + comisión" que se escribe en `expenses`. Con más
  // de 1.000 comisiones en el mes, PostgREST recortaba la lista sin avisar y el gasto del mes salía
  // más bajo que el real — un error contable con toda la pinta de dato bueno.
  const {
    rows: periodCommissions,
    error: commissionsErr,
    truncated,
  } = await fetchAllRows<{
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
  if (commissionsErr) throw errorDe('No se pudieron leer las comisiones del periodo', { message: commissionsErr })
  if (truncated) throw new Error('No se pudieron leer TODAS las comisiones del periodo (tope de páginas)')
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
  const { data: templates, error: templatesErr } = await sb
    .from('expenses')
    .select('id, concept, category, subcategory, amount, counterparty, person_id')
    .eq('tenant_id', tenantId)
    .eq('recurring', true)
    .eq('frequency', 'mensual')
    .is('auto_source', null)
  if (templatesErr) throw errorDe('No se pudieron leer las plantillas de gastos recurrentes', templatesErr)
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

  // Corte por presupuesto ANTES de escribir: con la lista ya construida, insertarla a medias
  // dejaría el periodo parcialmente generado sin declaración. La pasada siguiente regenera todo
  // (upsert idempotente por (auto_source, period)).
  if (Date.now() > deadline) return { period, candidates: rows.length, inserted: 0, synced: 0, cortado: true }

  let inserted = 0
  if (rows.length) {
    // upsert con ignoreDuplicates para respetar el índice único (auto_source, period)
    const { data, error } = await sb
      .from('expenses')
      .upsert(rows, { onConflict: 'auto_source,period', ignoreDuplicates: true })
      .select('id')
    if (error) throw errorDe('No se pudieron crear los gastos del periodo', error)
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
    if (error) throw errorDe(`No se pudo sincronizar el importe de ${s.auto_source}`, error)
    synced += data?.length ?? 0
  }

  return { period, candidates: rows.length, inserted, synced }
}

// Vercel Cron pega a una única URL estática, así que este handler recorre TODAS las
// subcuentas activas y corre la generación de gastos mensuales una vez por cada una
// (filtrando/estampando tenant_id en cada lectura/escritura de runForTenant).
async function run(deadline: number) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
  if (tenantsErr) throw errorDe('No se pudieron leer las subcuentas activas', tenantsErr)

  // El presupuesto se reparte entre subcuentas: con un único deadline global la primera se lo
  // comería entero y las demás no generaban nunca (mismo reparto que analyze-calls).
  const targets = tenants || []
  const perTenantBudget = TIME_BUDGET_MS / Math.max(targets.length, 1)
  const perTenant: Record<string, TenantResult | { error: string }> = {}
  for (const tn of targets) {
    try {
      perTenant[tn.slug] = await runForTenant(sb, tn.id, Date.now() + perTenantBudget)
    } catch (e) {
      // Un fallo en una subcuenta no aborta el barrido de las demás, pero SI constar:
      // el trigger falla (run en rojo, rerun idempotente) y el motivo queda en la respuesta.
      perTenant[tn.slug] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { tenants: perTenant }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const tenants = await run(Date.now() + TIME_BUDGET_MS)
    // 500 si alguna subcuenta falló: el run en rojo de Actions es el único aviso que alguien va a
    // ver, el rerun es idempotente (upsert por (auto_source, period)) y el corte por presupuesto
    // NO llega aquí (se declara como `cortado`, no como error — la pasada siguiente continúa).
    if (Object.values(tenants).some((r) => 'error' in r)) {
      return NextResponse.json({ ok: false, tenants }, { status: 500 })
    }
    return NextResponse.json({ ok: true, tenants })
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
    return NextResponse.json({ ok: true, ...(await runForTenant(sb, session.tenantId, Date.now() + TIME_BUDGET_MS)) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
