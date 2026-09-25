import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateCommissionsForCollection, pickCommissionRule } from './calculator'
import { resolveSaleAttribution } from './attribution'
import { tramoIdByReps } from './tramos'
import { usuariosColaboradoresActivos } from '@/lib/collaborators/scope'
import { fetchStripeFeesForReferences } from '@/lib/finance/stripeFees'
import { getTenantConfigWithFallback } from '@/lib/config'
import type { Collection, Sale, CommissionRule, InsertCommission } from '@/lib/types/database'

type Role = 'setter' | 'closer'

// TODA función de este módulo recibe el `tenantId` y lo aplica a cada lectura y cada escritura.
//
// POR QUÉ, con nombres y apellidos. Este módulo se quedó fuera de la migración multi-tenant: no
// aparecía `tenant_id` ni una vez. Con un cliente service-role (que salta RLS) eso significaba:
//   · las comisiones se INSERTABAN sin tenant_id, y como la columna es NOT NULL el insert fallaba
//     siempre… con el error descartado (`await sb.from('commissions').insert(...)` sin comprobarlo).
//     La ruta devolvía `commissionsGenerated: 3` habiendo escrito CERO filas. Dinero que el equipo
//     ve prometido en pantalla y no existe en la base de datos.
//   · `commission_rules` se leía de TODAS las subcuentas: el % de una se aplicaba a las ventas de otra.
//   · `recomputeRepCommissionTiers` hacía UPDATE de comisiones por `user_id` sin acotar subcuenta:
//     podía reescribir el % de comisiones ajenas.
//   · el cash collected que decide el tramo sumaba cobros de todas las subcuentas.

// Plan personalizado: solo el primer pago que adelanta el cliente (reserva/entrada) comisiona al
// instante. Cualquier cobro posterior de la misma venta, si ya existe un cobro elegible previo,
// debe quedar en revisión manual de cobros en vez de generar comisión real de inmediato.
//
// RESERVA QUE AÚN NO ES CLIENTE: quien solo reserva (method='reserva' y `reservation_completed_at`
// sigue null) no ha "empezado a pagar" en el sentido de negocio — solo asegura una plaza. El cobro
// de esa reserva NO comisiona a nadie (ni closer, ni setter, ni colaborador) hasta que la persona
// complete el pago (fraccionado o total): en ese momento `complete-reservation` reabre este cobro
// para que SÍ comisione (ver ese route). Antes de esto, cualquier `method === 'reserva'` sin
// completar generaba su comisión al instante, exactamente igual que un cobro normal.
export async function saleNeedsCommissionReview(
  sb: SupabaseClient,
  tenantId: string,
  saleId: string,
  planMethod: string | null | undefined,
  reservationCompletedAt?: string | null
): Promise<boolean> {
  if (planMethod === 'reserva' && !reservationCompletedAt) return true
  if (planMethod !== 'custom') return false
  const { data: existingEligible } = await sb
    .from('collections')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sale_id', saleId)
    .eq('is_eligible_for_commission', true)
    .neq('status', 'reversed')
    .limit(1)
  return !!(existingEligible && existingEligible.length > 0)
}

// Cash collected BRUTO neto de devoluciones acumulado por un rep en un rol concreto.
// Es el "Cash Collected" que el equipo ve en el dashboard (collections.gross_amount) y el que
// determina el TRAMO de comisión (min_cash / max_cash de commission_rules). Se resta lo devuelto
// para que, si un cliente devuelve y el rep baja de tramo, el % se recalcule a la baja.
export async function repNetCash(sb: SupabaseClient, tenantId: string, repId: string, role: Role): Promise<number> {
  const col = role === 'setter' ? 'setter_id' : 'closer_id'
  const { data: colls } = await sb
    .from('collections')
    .select(`gross_amount, sales!inner(${col})`)
    .eq('tenant_id', tenantId)
    .eq('status', 'collected')
    .eq(`sales.${col}`, repId)
    .limit(10000)
  const gross = (colls ?? []).reduce(
    (s: number, c: { gross_amount: number | string }) => s + Number(c.gross_amount || 0),
    0
  )
  const { data: refs } = await sb
    .from('refunds')
    .select(`gross_refund_amount, sales!inner(${col})`)
    .eq('tenant_id', tenantId)
    .eq(`sales.${col}`, repId)
    .limit(10000)
  const refunded = (refs ?? []).reduce(
    (s: number, r: { gross_refund_amount: number | string }) => s + Number(r.gross_refund_amount || 0),
    0
  )
  return Math.max(gross - refunded, 0)
}

// Recalcula el TRAMO (% + importe) de TODAS las comisiones positivas no liquidadas de cada rep,
// según su cash collected acumulado actual. Aplica el modelo "en tiempo real": al cruzar un umbral
// (p.ej. 10.000€) todas sus comisiones pasan al nuevo %, y si baja por una devolución, vuelven al
// % que le corresponda. Las liquidadas (ya pagadas) NO se tocan. Los afiliados llevan % fijo de la
// venta, así que quedan fuera de los tramos.
export async function recomputeRepCommissionTiers(
  sb: SupabaseClient,
  tenantId: string,
  pairs: { repId: string | null | undefined; role: Role }[]
): Promise<void> {
  const rules = await activeRules(sb, tenantId)
  const now = new Date()
  const seen = new Set<string>()

  // Tramo batcheado una sola vez para todos los reps de `pairs` (antes se llamaba
  // tramoIdByReps(sb, [repId]) dentro del loop, recargando la config de tramos —
  // sales_tramos + sales_tramos_config — en cada iteración en vez de una sola vez).
  const uniqueRepIds = Array.from(new Set(pairs.map((p) => p.repId).filter((x): x is string => !!x)))
  const tramoMap = await tramoIdByReps(sb, tenantId, uniqueRepIds)

  for (const { repId, role } of pairs) {
    if (!repId) continue
    const key = `${repId}|${role}`
    if (seen.has(key)) continue
    seen.add(key)

    const total = await repNetCash(sb, tenantId, repId, role)
    const rule = pickCommissionRule(rules, role, repId, now, total, tramoMap[repId] ?? null)
    const percent = rule?.percent ?? (role === 'setter' ? 5 : 10)

    const { data: comms } = await sb
      .from('commissions')
      .select('id, base_amount, percent')
      .eq('tenant_id', tenantId)
      .eq('user_id', repId)
      .eq('participant_type', role)
      .eq('direction', 'positive')
      .neq('status', 'liquidated')

    // Batcheado en un solo upsert por PK en vez de un UPDATE individual por comisión —
    // esto corre en el hot path de "registrar cobro" (generateCommissionsForCollection),
    // así que un rep con decenas de comisiones no liquidadas generaba decenas de round-trips.
    const toUpdate = (comms ?? [])
      .filter((cm) => Number(cm.percent) !== percent)
      .map((cm) => ({ id: cm.id, percent, commission_amount: Math.round(Number(cm.base_amount) * percent) / 100 }))
    if (toUpdate.length) {
      // El upsert por PK necesita tenant_id: la fila se reescribe completa y la columna es NOT NULL,
      // así que sin él este "recalcular tramos" fallaba entero y el % se quedaba como estaba.
      const { error } = await sb.from('commissions').upsert(toUpdate.map((u) => ({ ...u, tenant_id: tenantId })))
      if (error) throw new Error(`No se pudo recalcular el tramo de comisión: ${error.message}`)
    }
  }
}

/** Reglas de comisión ACTIVAS de esta subcuenta. Leerlas sin filtrar aplicaba el % de otra. */
async function activeRules(sb: SupabaseClient, tenantId: string): Promise<CommissionRule[]> {
  const { data, error } = await sb.from('commission_rules').select('*').eq('tenant_id', tenantId).eq('is_active', true)
  if (error) throw new Error(`No se pudieron leer las reglas de comisión: ${error.message}`)
  return (data ?? []) as CommissionRule[]
}

// Quiénes de estos user_ids tienen `pays_commissions = false` (p.ej. un socio): no se les genera
// comisión de closer/setter/afiliado por ningún cobro. Ausente/NULL en la columna = comisiona (el
// valor por defecto es `true`), así que solo se excluye a quien lo tenga EXPLÍCITAMENTE a false.
async function usuariosSinComision(sb: SupabaseClient, userIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)))
  if (!ids.length) return new Set()
  const { data } = await sb.from('users').select('id, pays_commissions').in('id', ids).eq('pays_commissions', false)
  return new Set((data ?? []).map((u) => u.id as string))
}

/**
 * Fee de pasarela por cobro (collection_id → fee) para la BASE NETA de comisión.
 *
 * Prioridad (función SQL commission_base_for_collection, migración 20260919100000):
 *   1. Fee REAL de Stripe: cobros con `payment_reference` cruzan contra el espejo
 *      `stripe_payments.stripe_fee` (poblado por el sync vía balance_transaction).
 *      Si hay referencias que el espejo aún no conoce y hay clave de Stripe
 *      configurada, se van a buscar a la API en el momento (pull bajo demanda).
 *   2. Sin Stripe (venta manual): `collections.processing_fee` — la referencia del
 *      plan que el formulario de cobro manual ya guardaba.
 *
 * Fallos de Stripe NO bloquean el cobro: devuelven lo que haya (el fallback del
 * plan) y el cron de sync cuadrará el espejo después.
 */
export async function feesForCollections(
  sb: SupabaseClient,
  tenantId: string,
  collections: Collection[]
): Promise<Map<string, number>> {
  const fees = new Map<string, number>()
  const conRef = collections.filter((c) => c.payment_reference)
  const refs = [...new Set(conRef.map((c) => c.payment_reference as string))]

  if (refs.length) {
    const { data: mirror } = await sb
      .from('stripe_payments')
      .select('payment_id, charge_id, stripe_fee')
      .eq('tenant_id', tenantId)
      .in('payment_id', refs)
    const rows = (mirror ?? []) as {
      payment_id: string
      charge_id: string | null
      stripe_fee: number | string | null
    }[]
    const byRef = new Map<string, number>()
    for (const r of rows) {
      if (r.stripe_fee == null) continue
      byRef.set(r.payment_id, Number(r.stripe_fee))
      if (r.charge_id) byRef.set(r.charge_id, Number(r.stripe_fee))
    }
    // Referencias que el espejo aún no conoce → pull puntual a la API de Stripe.
    const faltan = refs.filter((r) => !byRef.has(r))
    if (faltan.length) {
      const cfg = await getTenantConfigWithFallback(tenantId, true)
      if (cfg.STRIPE_SECRET_KEY) {
        try {
          const traidos = await fetchStripeFeesForReferences(cfg.STRIPE_SECRET_KEY, cfg.STRIPE_ACCOUNT_ID, faltan)
          for (const [ref, fee] of traidos) byRef.set(ref, fee)
        } catch {
          // Stripe caído/lento: el fee del plan (fallback) cubre el cobro y el sync cuadrará el espejo.
        }
      }
    }
    for (const c of conRef) {
      const fee = byRef.get(c.payment_reference as string)
      if (fee != null) fees.set(c.id, fee)
    }
  }

  // 2) Sin fee real de Stripe: la referencia del plan del cobro manual (si la hay).
  for (const c of collections) {
    if (!fees.has(c.id)) {
      const planFee = Number(c.processing_fee ?? 0)
      if (planFee > 0) fees.set(c.id, planFee)
    }
  }
  return fees
}

// Genera las comisiones (setter/closer/afiliado) para un cobro concreto y las inserta como
// PENDIENTES. Se llama en CADA cobro (cuota, reserva, entrada o cobro manual) para que la
// comisión aparezca al instante en Comisiones y en el P&L. Tras insertarlas, recalcula los tramos
// del rep para que reflejen su nivel actual en tiempo real. La aprobación/liquidación es
// automática pasada la ventana de devolución (cron) salvo que se marque una devolución.
export async function generateCommissionsForCollection(
  sb: SupabaseClient,
  tenantId: string,
  collection: Collection,
  sale: Sale
): Promise<number> {
  // Solo generamos si hay alguien a quien comisionar
  if (!sale.setter_id && !sale.closer_id && !(sale.affiliate_id && sale.affiliate_commission_percent)) {
    return 0
  }

  const rules = await activeRules(sb, tenantId)

  // Cash collected BRUTO acumulado por rep (para elegir el tramo correcto). Neto de devoluciones.
  const cashByRep: Record<string, number> = {}
  if (sale.setter_id) cashByRep[sale.setter_id] = await repNetCash(sb, tenantId, sale.setter_id, 'setter')
  if (sale.closer_id) cashByRep[sale.closer_id] = await repNetCash(sb, tenantId, sale.closer_id, 'closer')

  // Tramo/nivel actual por rep (para reglas de comisión enlazadas a un tramo).
  const tramoByRep = await tramoIdByReps(sb, tenantId, [sale.setter_id, sale.closer_id])

  // Colaboradores activos de la subcuenta: sus comisiones van con
  // participant_type='collaborator' (misma matemática, lane propia del ledger).
  const colaboradoresActivos = await usuariosColaboradoresActivos(sb, tenantId)

  // BASE NETA de pasarela: el fee real (Stripe por espejo/API o el del plan) descuenta de la base
  // de TODAS las comisiones de este cobro — setter, closer, clásico y colaborador por igual.
  const fees = await feesForCollections(sb, tenantId, [collection])

  // Quien tenga `pays_commissions = false` (p.ej. un socio) no recibe comisión de este cobro.
  const noComisionan = await usuariosSinComision(sb, [sale.setter_id, sale.closer_id, sale.affiliate_id])

  const commissions = calculateCommissionsForCollection(
    tenantId,
    collection,
    sale,
    rules,
    cashByRep,
    tramoByRep,
    colaboradoresActivos,
    fees.get(collection.id) ?? 0,
    noComisionan
  )
  // Se devuelven las filas ESCRITAS, no las calculadas, y un fallo se propaga. Antes se devolvía
  // `commissions.length` con el error del insert descartado: la pantalla decía "3 comisiones
  // generadas" con cero filas en la base de datos.
  let inserted = 0
  if (commissions.length > 0) {
    const { data, error } = await sb.from('commissions').insert(commissions).select('id')
    if (error) throw new Error(`No se pudieron generar las comisiones: ${error.message}`)
    inserted = data?.length ?? 0
  }

  // Recalcula los tramos de todas las comisiones no liquidadas del rep (modelo tiempo real)
  await recomputeRepCommissionTiers(sb, tenantId, [
    { repId: sale.setter_id, role: 'setter' },
    { repId: sale.closer_id, role: 'closer' },
  ])

  return inserted
}

// Reconcilia las comisiones de UNA venta a partir de la verdad (sus cobros reales + los reps
// asignados AHORA). Reconstruye las comisiones POSITIVAS ligadas a cobro que no estén liquidadas,
// de forma idempotente: se puede llamar tantas veces como haga falta y el resultado es el mismo.
// Se usa (1) cuando se asigna/cambia el rep de una venta ya creada, para regenerar lo que falta, y
// (2) como reparación masiva para cuadrar la contabilidad.
//
// Reglas de seguridad:
//  - NUNCA toca comisiones LIQUIDADAS (ya pagadas): se conservan y se evita duplicarlas.
//  - NUNCA toca comisiones NEGATIVAS (devoluciones): quedan intactas.
//  - Recalcula los tramos (%) de los reps afectados (nuevos y, vía `alsoRecompute`, los antiguos).
export async function reconcileSaleCommissions(
  sb: SupabaseClient,
  tenantId: string,
  saleId: string,
  alsoRecompute: { repId: string | null | undefined; role: Role }[] = [],
  opts: { skipTierRecompute?: boolean } = {}
): Promise<{ created: number; deleted: number; keptLiquidated: number }> {
  const { data: sale } = await sb.from('sales').select('*').eq('tenant_id', tenantId).eq('id', saleId).maybeSingle()
  if (!sale) return { created: 0, deleted: 0, keptLiquidated: 0 }
  const s = sale as Sale

  // Si le falta setter/afiliado, dedúcelos de la atribución (UTM) del contacto antes de reconciliar,
  // para que el rep atribuido por utm_term/utm_content reciba su comisión (también en reparación masiva).
  const attrPatch = await resolveSaleAttribution(sb, s, tenantId)
  Object.assign(s, attrPatch)

  const { data: collsData } = await sb
    .from('collections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('sale_id', saleId)
    .eq('status', 'collected')
    .eq('needs_commission_review', false)
  const colls = (collsData ?? []) as Collection[]

  const { data: existingData } = await sb
    .from('commissions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('sale_id', saleId)
  const existing = (existingData ?? []) as {
    id: string
    collection_id: string | null
    user_id: string
    participant_type: string
    direction: string
    status: string
  }[]

  // Claves de comisiones ya LIQUIDADAS (pagadas) → no se recrean ni se borran
  const liqKeys = new Set(
    existing
      .filter((c) => c.status === 'liquidated' && c.direction === 'positive')
      .map((c) => `${c.collection_id}|${c.user_id}|${c.participant_type}`)
  )

  // Borra las positivas ligadas a cobro que NO estén liquidadas (se reconstruyen abajo).
  // Las negativas (devoluciones) y las liquidadas quedan fuera.
  const toDelete = existing.filter((c) => c.direction === 'positive' && c.status !== 'liquidated' && c.collection_id)
  let deleted = 0
  if (toDelete.length) {
    const { data: gone, error } = await sb
      .from('commissions')
      .delete()
      .eq('tenant_id', tenantId)
      .in(
        'id',
        toDelete.map((c) => c.id)
      )
      .select('id')
    if (error) throw new Error(`No se pudieron limpiar las comisiones a reconstruir: ${error.message}`)
    deleted = gone?.length ?? 0
  }

  const rules = await activeRules(sb, tenantId)

  // Cash acumulado por rep para elegir el tramo (independiente de las comisiones: sale de collections)
  const cashByRep: Record<string, number> = {}
  if (s.setter_id) cashByRep[s.setter_id] = await repNetCash(sb, tenantId, s.setter_id, 'setter')
  if (s.closer_id) cashByRep[s.closer_id] = await repNetCash(sb, tenantId, s.closer_id, 'closer')

  // Tramo/nivel actual por rep (para reglas de comisión enlazadas a un tramo).
  const tramoByRep = await tramoIdByReps(sb, tenantId, [s.setter_id, s.closer_id])

  // Colaboradores activos: lane 'collaborator' del ledger, igual que en el hot path.
  const colaboradoresActivos = await usuariosColaboradoresActivos(sb, tenantId)

  // BASE NETA: mismo fee por cobro que usa el hot path (espejo/API Stripe o plan del cobro manual).
  const fees = await feesForCollections(sb, tenantId, colls)

  // Quien tenga `pays_commissions = false` (p.ej. un socio) no recibe comisión al reconciliar.
  const noComisionan = await usuariosSinComision(sb, [s.setter_id, s.closer_id, s.affiliate_id])

  const toInsert: InsertCommission[] = []
  for (const col of colls) {
    const rows = calculateCommissionsForCollection(
      tenantId,
      col,
      s,
      rules,
      cashByRep,
      tramoByRep,
      colaboradoresActivos,
      fees.get(col.id) ?? 0,
      noComisionan
    )
    for (const r of rows) {
      const key = `${r.collection_id}|${r.user_id}|${r.participant_type}`
      if (liqKeys.has(key)) continue // ya pagada, no duplicar
      toInsert.push(r)
    }
  }
  let created = 0
  if (toInsert.length) {
    const { data, error } = await sb.from('commissions').insert(toInsert).select('id')
    if (error) throw new Error(`No se pudieron reconstruir las comisiones: ${error.message}`)
    created = data?.length ?? 0
  }

  // Recalcula tramos: reps actuales de la venta + los que se indiquen (p.ej. reps anteriores al cambio).
  // skipTierRecompute lo usa la reparación masiva (reconcile-all): recalcular el tramo de un rep
  // DESPUÉS de cada una de sus N ventas (en vez de una vez al final, con el cash ya consolidado)
  // es trabajo repetido — recomputeRepCommissionTiers es idempotente, así que el resultado final
  // es el mismo, pero recalculándolo N veces por rep en vez de 1 es el N+1 real de ese endpoint.
  if (!opts.skipTierRecompute) {
    await recomputeRepCommissionTiers(sb, tenantId, [
      { repId: s.setter_id, role: 'setter' },
      { repId: s.closer_id, role: 'closer' },
      ...alsoRecompute,
    ])
  }

  return { created, deleted, keptLiquidated: liqKeys.size }
}
