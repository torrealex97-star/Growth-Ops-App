import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateCommissionsForCollection, pickCommissionRule } from './calculator'
import { resolveSaleAttribution } from './attribution'
import { tramoIdByReps } from './tramos'
import type { Collection, Sale, CommissionRule, InsertCommission } from '@/lib/types/database'

type Role = 'setter' | 'closer'

// Plan personalizado: solo el primer pago que adelanta el cliente (reserva/entrada) comisiona al
// instante. Cualquier cobro posterior de la misma venta, si ya existe un cobro elegible previo,
// debe quedar en revisión manual de cobros en vez de generar comisión real de inmediato.
export async function saleNeedsCommissionReview(
  sb: SupabaseClient,
  saleId: string,
  planMethod: string | null | undefined
): Promise<boolean> {
  if (planMethod !== 'custom') return false
  const { data: existingEligible } = await sb
    .from('collections')
    .select('id')
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
export async function repNetCash(sb: SupabaseClient, repId: string, role: Role): Promise<number> {
  const col = role === 'setter' ? 'setter_id' : 'closer_id'
  const { data: colls } = await sb
    .from('collections')
    .select(`gross_amount, sales!inner(${col})`)
    .eq('status', 'collected')
    .eq(`sales.${col}`, repId)
  const gross = (colls ?? []).reduce(
    (s: number, c: { gross_amount: number | string }) => s + Number(c.gross_amount || 0),
    0
  )
  const { data: refs } = await sb
    .from('refunds')
    .select(`gross_refund_amount, sales!inner(${col})`)
    .eq(`sales.${col}`, repId)
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
  pairs: { repId: string | null | undefined; role: Role }[]
): Promise<void> {
  const { data: rulesData } = await sb.from('commission_rules').select('*').eq('is_active', true)
  const rules = (rulesData ?? []) as CommissionRule[]
  const now = new Date()
  const seen = new Set<string>()

  for (const { repId, role } of pairs) {
    if (!repId) continue
    const key = `${repId}|${role}`
    if (seen.has(key)) continue
    seen.add(key)

    const total = await repNetCash(sb, repId, role)
    const tramoMap = await tramoIdByReps(sb, [repId])
    const rule = pickCommissionRule(rules, role, repId, now, total, tramoMap[repId] ?? null)
    const percent = rule?.percent ?? (role === 'setter' ? 5 : 10)

    const { data: comms } = await sb
      .from('commissions')
      .select('id, base_amount, percent')
      .eq('user_id', repId)
      .eq('participant_type', role)
      .eq('direction', 'positive')
      .neq('status', 'liquidated')

    for (const cm of comms ?? []) {
      if (Number(cm.percent) === percent) continue
      const newAmount = Math.round(Number(cm.base_amount) * percent) / 100
      await sb.from('commissions').update({ percent, commission_amount: newAmount }).eq('id', cm.id)
    }
  }
}

// Genera las comisiones (setter/closer/afiliado) para un cobro concreto y las inserta como
// PENDIENTES. Se llama en CADA cobro (cuota, reserva, entrada o cobro manual) para que la
// comisión aparezca al instante en Comisiones y en el P&L. Tras insertarlas, recalcula los tramos
// del rep para que reflejen su nivel actual en tiempo real. La aprobación/liquidación es
// automática pasada la ventana de devolución (cron) salvo que se marque una devolución.
export async function generateCommissionsForCollection(
  sb: SupabaseClient,
  collection: Collection,
  sale: Sale
): Promise<number> {
  // Solo generamos si hay alguien a quien comisionar
  if (!sale.setter_id && !sale.closer_id && !(sale.affiliate_id && sale.affiliate_commission_percent)) {
    return 0
  }

  const { data: rulesData } = await sb.from('commission_rules').select('*').eq('is_active', true)
  const rules = (rulesData ?? []) as CommissionRule[]

  // Cash collected BRUTO acumulado por rep (para elegir el tramo correcto). Neto de devoluciones.
  const cashByRep: Record<string, number> = {}
  if (sale.setter_id) cashByRep[sale.setter_id] = await repNetCash(sb, sale.setter_id, 'setter')
  if (sale.closer_id) cashByRep[sale.closer_id] = await repNetCash(sb, sale.closer_id, 'closer')

  // Tramo/nivel actual por rep (para reglas de comisión enlazadas a un tramo).
  const tramoByRep = await tramoIdByReps(sb, [sale.setter_id, sale.closer_id])

  const commissions = calculateCommissionsForCollection(collection, sale, rules, cashByRep, tramoByRep)
  if (commissions.length > 0) {
    await sb.from('commissions').insert(commissions)
  }

  // Recalcula los tramos de todas las comisiones no liquidadas del rep (modelo tiempo real)
  await recomputeRepCommissionTiers(sb, [
    { repId: sale.setter_id, role: 'setter' },
    { repId: sale.closer_id, role: 'closer' },
  ])

  return commissions.length
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
  saleId: string,
  alsoRecompute: { repId: string | null | undefined; role: Role }[] = []
): Promise<{ created: number; deleted: number; keptLiquidated: number }> {
  const { data: sale } = await sb.from('sales').select('*').eq('id', saleId).single()
  if (!sale) return { created: 0, deleted: 0, keptLiquidated: 0 }
  const s = sale as Sale

  // Si le falta setter/afiliado, dedúcelos de la atribución (UTM) del contacto antes de reconciliar,
  // para que el rep atribuido por utm_term/utm_content reciba su comisión (también en reparación masiva).
  const attrPatch = await resolveSaleAttribution(sb, s)
  Object.assign(s, attrPatch)

  const { data: collsData } = await sb
    .from('collections')
    .select('*')
    .eq('sale_id', saleId)
    .eq('status', 'collected')
    .eq('needs_commission_review', false)
  const colls = (collsData ?? []) as Collection[]

  const { data: existingData } = await sb.from('commissions').select('*').eq('sale_id', saleId)
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
  if (toDelete.length) {
    await sb
      .from('commissions')
      .delete()
      .in(
        'id',
        toDelete.map((c) => c.id)
      )
  }

  const { data: rulesData } = await sb.from('commission_rules').select('*').eq('is_active', true)
  const rules = (rulesData ?? []) as CommissionRule[]

  // Cash acumulado por rep para elegir el tramo (independiente de las comisiones: sale de collections)
  const cashByRep: Record<string, number> = {}
  if (s.setter_id) cashByRep[s.setter_id] = await repNetCash(sb, s.setter_id, 'setter')
  if (s.closer_id) cashByRep[s.closer_id] = await repNetCash(sb, s.closer_id, 'closer')

  // Tramo/nivel actual por rep (para reglas de comisión enlazadas a un tramo).
  const tramoByRep = await tramoIdByReps(sb, [s.setter_id, s.closer_id])

  const toInsert: InsertCommission[] = []
  for (const col of colls) {
    const rows = calculateCommissionsForCollection(col, s, rules, cashByRep, tramoByRep)
    for (const r of rows) {
      const key = `${r.collection_id}|${r.user_id}|${r.participant_type}`
      if (liqKeys.has(key)) continue // ya pagada, no duplicar
      toInsert.push(r)
    }
  }
  if (toInsert.length) {
    await sb.from('commissions').insert(toInsert)
  }

  // Recalcula tramos: reps actuales de la venta + los que se indiquen (p.ej. reps anteriores al cambio)
  await recomputeRepCommissionTiers(sb, [
    { repId: s.setter_id, role: 'setter' },
    { repId: s.closer_id, role: 'closer' },
    ...alsoRecompute,
  ])

  return { created: toInsert.length, deleted: toDelete.length, keptLiquidated: liqKeys.size }
}
