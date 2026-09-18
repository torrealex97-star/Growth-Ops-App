import { addMonths, startOfMonth } from 'date-fns'
import type {
  Collection,
  Commission,
  InsertCommission,
  Sale,
  CommissionRule,
  Refund,
  ParticipantType,
} from '@/lib/types/database'

// COLABORADORES (migración 20260918150000): los beneficiarios con perfil de
// colaborador ACTIVO emiten su comisión con participant_type='collaborator'
// (lane nativa del ledger) en vez de 'affiliate'. Mismo motor, misma base (cash
// collected), mismos estados y misma idempotencia; la etiqueta distingue al
// colectivo para permisos, UI y reporting. Los 'affiliate' históricos (usuarios
// con affiliate_code sin perfil) siguen saliendo exactamente igual.
export function participantTypeForUser(
  userId: string | null | undefined,
  colaboradoresActivos?: Set<string> | null
): ParticipantType {
  if (userId && colaboradoresActivos && colaboradoresActivos.has(userId)) return 'collaborator'
  return 'affiliate'
}

function getLiquidationMonth(collectedAt: Date): string {
  // First day of NEXT month
  const nextMonth = addMonths(collectedAt, 1)
  const firstDay = startOfMonth(nextMonth)
  return firstDay.toISOString().split('T')[0]
}

function getCurrentLiquidationMonth(): string {
  // First day of CURRENT month
  const firstDay = startOfMonth(new Date())
  return firstDay.toISOString().split('T')[0]
}

// Elige la regla dentro de un pool ya acotado (mismo tipo, vigente, mismo alcance rep/genérico).
// 1) Si el rep está en un tramo y hay reglas enlazadas a ESE tramo, gana la de mayor %.
// 2) Si no, compiten SOLO las reglas sin tramo (modelo por cash collected): tramo por min/max_cash.
function pickRuleFromPool(
  pool: CommissionRule[],
  repCash: number,
  repTramo: string | null
): CommissionRule | undefined {
  if (repTramo) {
    const tramoMatch = pool.filter((r) => r.tramo_id === repTramo)
    if (tramoMatch.length) return tramoMatch.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]
  }
  // Las reglas ligadas a un tramo NO aplican fuera de su tramo → se excluyen del modelo por cash.
  const cashPool = pool.filter((r) => !r.tramo_id)
  const inTier = cashPool.filter((r) => repCash >= (r.min_cash ?? 0) && (r.max_cash == null || repCash < r.max_cash))
  if (inTier.length) return inTier.sort((a, b) => (b.min_cash ?? 0) - (a.min_cash ?? 0))[0]
  const below = cashPool
    .filter((r) => repCash >= (r.min_cash ?? 0))
    .sort((a, b) => (b.min_cash ?? 0) - (a.min_cash ?? 0))
  return below[0] ?? cashPool[0]
}

export function calculateCommissionsForCollection(
  // La subcuenta va PRIMERO y es obligatoria: `commissions.tenant_id` es NOT NULL, así que una fila
  // sin él no se puede insertar. Antes no se estampaba y el insert fallaba siempre (en silencio).
  tenantId: string,
  collection: Collection,
  sale: Sale,
  rules: CommissionRule[],
  // Cash collected acumulado por rep (userId → €) para elegir el tramo. Opcional.
  cashByRep?: Record<string, number>,
  // Tramo/nivel de gamificación actual por rep (userId → tramoId). Si el rep tiene un tramo y hay
  // una regla enlazada a ese tramo, esa regla gana sobre el modelo por cash collected. Opcional.
  tramoByRep?: Record<string, string | null>,
  // user_ids con perfil de colaborador activo → participant_type='collaborator'. Opcional.
  colaboradoresActivos?: Set<string> | null
): InsertCommission[] {
  const commissions: InsertCommission[] = []
  const collectedAt = new Date(collection.collected_at)
  const liquidationMonth = getLiquidationMonth(collectedAt)
  const baseAmount = collection.commissionable_amount

  // Selecciona la regla aplicable: activa y vigente, priorizando la del rep concreto
  // sobre la genérica. Si el rep está en un TRAMO/nivel y existe regla enlazada a ese tramo, esa
  // gana; si no, se elige el TRAMO por cash collected acumulado del rep (modelo clásico).
  const getRule = (participantType: string, repId?: string | null) => {
    const repCash = (repId && cashByRep?.[repId]) || 0
    const repTramo = (repId && tramoByRep?.[repId]) || null
    const active = rules.filter(
      (r) =>
        r.participant_type === participantType &&
        r.is_active &&
        new Date(r.active_from) <= collectedAt &&
        (!r.active_to || new Date(r.active_to) >= collectedAt)
    )
    // Reglas del rep concreto tienen prioridad; si no hay, se usan las genéricas (user_id null)
    const scoped = active.filter((r) => r.user_id === repId)
    const pool = scoped.length ? scoped : active.filter((r) => !r.user_id)
    return pickRuleFromPool(pool, repCash, repTramo)
  }

  // Setter commission
  if (sale.setter_id) {
    const rule = getRule('setter', sale.setter_id)
    const percent = rule?.percent ?? 5
    commissions.push({
      tenant_id: tenantId,
      sale_id: sale.id,
      collection_id: collection.id,
      refund_id: null,
      user_id: sale.setter_id,
      participant_type: 'setter',
      percent,
      base_amount: baseAmount,
      commission_amount: (baseAmount * percent) / 100,
      direction: 'positive',
      status: 'pending',
      liquidation_month: liquidationMonth,
      approved_by: null,
      notes: null,
    })
  }

  // Closer commission
  if (sale.closer_id) {
    const rule = getRule('closer', sale.closer_id)
    const percent = rule?.percent ?? 10
    commissions.push({
      tenant_id: tenantId,
      sale_id: sale.id,
      collection_id: collection.id,
      refund_id: null,
      user_id: sale.closer_id,
      participant_type: 'closer',
      percent,
      base_amount: baseAmount,
      commission_amount: (baseAmount * percent) / 100,
      direction: 'positive',
      status: 'pending',
      liquidation_month: liquidationMonth,
      approved_by: null,
      notes: null,
    })
  }

  // Affiliate / Collaborator commission
  if (sale.affiliate_id && sale.affiliate_commission_percent) {
    const percent = sale.affiliate_commission_percent
    commissions.push({
      tenant_id: tenantId,
      sale_id: sale.id,
      collection_id: collection.id,
      refund_id: null,
      user_id: sale.affiliate_id,
      participant_type: participantTypeForUser(sale.affiliate_id, colaboradoresActivos),
      percent,
      base_amount: baseAmount,
      commission_amount: (baseAmount * percent) / 100,
      direction: 'positive',
      status: 'pending',
      liquidation_month: liquidationMonth,
      approved_by: null,
      notes: null,
    })
  }

  return commissions
}

// Selección de la regla de comisión aplicable (activa/vigente, priorizando la del rep concreto y
// el tramo según el cash acumulado). Se usa tanto para la comisión real (cobros) como para
// proyectar la comisión FUTURA de las cuotas aún no cobradas.
export function pickCommissionRule(
  rules: CommissionRule[],
  participantType: string,
  repId: string | null | undefined,
  refDate: Date,
  repCash = 0,
  repTramo: string | null = null
): CommissionRule | null {
  const active = rules.filter(
    (r) =>
      r.participant_type === participantType &&
      r.is_active &&
      new Date(r.active_from) <= refDate &&
      (!r.active_to || new Date(r.active_to) >= refDate)
  )
  const scoped = active.filter((r) => r.user_id === repId)
  const pool = scoped.length ? scoped : active.filter((r) => !r.user_id)
  return pickRuleFromPool(pool, repCash, repTramo) ?? null
}

export function calculateNegativeCommissionsForRefund(
  refund: Refund,
  existingCommissions: Commission[]
): InsertCommission[] {
  const liquidationMonth = getCurrentLiquidationMonth()
  const negativeCommissions: InsertCommission[] = []

  // For each existing positive commission on this sale, create a negative mirror
  const positiveCommissions = existingCommissions.filter(
    (c) => c.sale_id === refund.sale_id && c.direction === 'positive'
  )

  for (const existing of positiveCommissions) {
    // Proportionally scale the negative commission based on refund amount vs original base
    const negativeCommission: InsertCommission = {
      // La subcuenta la hereda de la comisión que está espejando: es la misma venta.
      tenant_id: existing.tenant_id,
      sale_id: refund.sale_id,
      collection_id: existing.collection_id,
      refund_id: refund.id,
      user_id: existing.user_id,
      participant_type: existing.participant_type,
      percent: existing.percent,
      base_amount: refund.commissionable_refund_amount,
      commission_amount: (refund.commissionable_refund_amount * existing.percent) / 100,
      direction: 'negative',
      status: 'pending',
      liquidation_month: liquidationMonth,
      approved_by: null,
      notes: `Devolución de venta ${refund.sale_id}`,
    }
    negativeCommissions.push(negativeCommission)
  }

  return negativeCommissions
}

function calculateExpectedInstallments(
  saleId: string,
  grossAmount: number,
  commissionableAmount: number,
  numberOfPayments: number,
  saleDate: Date
) {
  const installments = []
  const installmentGross = grossAmount / numberOfPayments
  const installmentCommissionable = commissionableAmount / numberOfPayments

  for (let i = 1; i <= numberOfPayments; i++) {
    const dueDate = new Date(saleDate)
    dueDate.setMonth(dueDate.getMonth() + (i - 1))

    installments.push({
      sale_id: saleId,
      installment_number: i,
      due_date: dueDate.toISOString().split('T')[0],
      expected_gross_amount: Math.round(installmentGross * 100) / 100,
      expected_commissionable_amount: Math.round(installmentCommissionable * 100) / 100,
      status: 'pending' as const,
    })
  }

  return installments
}

// Autofinanciado con trato especial: parte ya pagada (reserva + entrada) NO genera cuota; el
// RESTO se divide en `restCount` cuotas mensuales que empiezan en `startDate`.
// Devuelve solo las cuotas del resto (la reserva/entrada se registran como cobros aparte).
export function buildRestInstallments(opts: {
  saleId: string
  totalGross: number // precio total (facturación)
  cashCollectionRatio: number // ratio para el importe comisionable de cada cuota
  alreadyPaid: number // reserva + entrada ya cobradas al momento
  restCount: number // nº de cuotas para el resto
  startDate: Date // fecha de la primera cuota del resto
}) {
  const { saleId, totalGross, cashCollectionRatio, alreadyPaid, restCount, startDate } = opts
  const remaining = Math.max(Math.round((totalGross - alreadyPaid) * 100) / 100, 0)
  const n = Math.max(1, Math.floor(restCount))
  if (remaining <= 0) return [] as ReturnType<typeof calculateExpectedInstallments>

  const per = Math.floor((remaining / n) * 100) / 100
  const ratio = cashCollectionRatio ?? 1
  const rows = []
  let allocated = 0
  for (let i = 1; i <= n; i++) {
    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + (i - 1))
    // La última cuota absorbe el redondeo para que sumen exactamente el resto
    const gross = i === n ? Math.round((remaining - allocated) * 100) / 100 : per
    allocated += per
    rows.push({
      sale_id: saleId,
      installment_number: i,
      due_date: dueDate.toISOString().split('T')[0],
      expected_gross_amount: gross,
      expected_commissionable_amount: Math.round(gross * ratio * 100) / 100,
      status: 'pending' as const,
    })
  }
  return rows
}
