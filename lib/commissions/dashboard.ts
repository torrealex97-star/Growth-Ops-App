import type { CommissionWithRelations, ParticipantType } from '@/lib/types/database'

export type CommissionDashboardRow = CommissionWithRelations & {
  sales: CommissionWithRelations['sales'] & { gross_amount: number; sale_date: string }
  collections: (CommissionWithRelations['collections'] & { gross_amount: number; collected_at: string }) | null
}

export type TeamCommissionSummary = {
  userId: string
  name: string
  participantType: ParticipantType
  booked: number
  collected: number
  generated: number
  outstanding: number
  paid: number
  sales: number
  collections: number
}

const signedAmount = (row: CommissionDashboardRow) =>
  Number(row.commission_amount || 0) * (row.direction === 'negative' ? -1 : 1)

/**
 * Atribución operativa por persona. Una misma venta/cobro solo se suma una vez por persona y rol,
 * aunque haya varias filas de comisión. No debe sumarse entre personas como total de empresa:
 * setter, closer y colaborador pueden compartir la atribución de una misma operación.
 */
export function buildTeamCommissionSummary(rows: CommissionDashboardRow[]): TeamCommissionSummary[] {
  const groups = new Map<string, TeamCommissionSummary & { seenSales: Set<string>; seenCollections: Set<string> }>()

  for (const row of rows) {
    const key = `${row.user_id}:${row.participant_type}`
    const group = groups.get(key) ?? {
      userId: row.user_id,
      name: row.users?.full_name || 'Sin nombre',
      participantType: row.participant_type,
      booked: 0,
      collected: 0,
      generated: 0,
      outstanding: 0,
      paid: 0,
      sales: 0,
      collections: 0,
      seenSales: new Set<string>(),
      seenCollections: new Set<string>(),
    }

    if (row.sale_id && !group.seenSales.has(row.sale_id)) {
      group.seenSales.add(row.sale_id)
      group.sales += 1
      group.booked += Number(row.sales?.gross_amount || 0)
    }
    if (row.collection_id && !group.seenCollections.has(row.collection_id)) {
      group.seenCollections.add(row.collection_id)
      group.collections += 1
      group.collected += Number(row.collections?.gross_amount || 0)
    }

    const amount = signedAmount(row)
    group.generated += amount
    if (row.status === 'liquidated') group.paid += amount
    if (row.status === 'pending' || row.status === 'approved') group.outstanding += amount
    groups.set(key, group)
  }

  return [...groups.values()]
    .map(({ seenSales: _seenSales, seenCollections: _seenCollections, ...row }) => row)
    .sort((a, b) => b.collected - a.collected || b.generated - a.generated || a.name.localeCompare(b.name))
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function nextMonthKey(date = new Date()): string {
  return monthKey(new Date(date.getFullYear(), date.getMonth() + 1, 1))
}

export function commissionSettlementSummary(rows: CommissionDashboardRow[], now = new Date()) {
  const current = monthKey(now)
  const next = nextMonthKey(now)
  const inMonth = (row: CommissionDashboardRow, month: string) =>
    String(row.liquidation_month || row.created_at).slice(0, 7) === month
  const amount = (items: CommissionDashboardRow[]) => items.reduce((sum, row) => sum + signedAmount(row), 0)

  const currentRows = rows.filter((row) => inMonth(row, current))
  const nextRows = rows.filter((row) => inMonth(row, next))
  return {
    current,
    next,
    toApprove: amount(currentRows.filter((row) => row.status === 'pending')),
    readyToPay: amount(currentRows.filter((row) => row.status === 'approved')),
    paid: amount(currentRows.filter((row) => row.status === 'liquidated')),
    nextCommitted: amount(nextRows.filter((row) => row.status === 'pending' || row.status === 'approved')),
  }
}
