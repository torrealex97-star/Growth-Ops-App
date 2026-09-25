import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { computeMonthlyPnl, FINANCE_QUERY_ROW_CAP } from '@/lib/finance/pnl'
import { calcularRepartoSocios } from '@/lib/finance/socios'
import type { AppRole } from '@/lib/auth/permissions'

export const runtime = 'nodejs'

const LEAD: AppRole[] = ['admin', 'director', 'manager']
const YM = /^\d{4}-\d{2}$/

// Reparto de socios sobre el BENEFICIO REAL del periodo (docs/MONEY.md D9): no es comisión de
// venta, es un % fijo sobre el Pre-Tax Profit de lib/finance/pnl.ts. Esta ruta agrega en el
// SERVIDOR y nunca devuelve filas crudas de sales/collections/expenses — solo el total del periodo
// y el reparto — para poder dar acceso a un socio sin rol de dirección sin enseñarle el detalle
// financiero fila a fila (que sí exige rol de dirección en el resto de Finanzas).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { searchParams } = new URL(req.url)
    const ymParam = searchParams.get('ym') || ''
    const ym = YM.test(ymParam) ? ymParam : new Date().toISOString().slice(0, 7)

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // ¿Es un socio con login vinculado a su propia fila? (partners.user_id, ver migración
    // 20260925110000_partners_user_id.sql). Si no hay LEAD ni vínculo, no hay nada que ver aquí.
    const role = (t.role as AppRole) || null
    const isLead = !!role && LEAD.includes(role)
    const { data: ownPartnerRow } = await sb
      .from('partners')
      .select('id')
      .eq('tenant_id', t.tenantId)
      .eq('user_id', t.userId)
      .eq('is_active', true)
      .maybeSingle()
    if (!isLead && !ownPartnerRow) {
      return NextResponse.json({ error: 'No tienes acceso al reparto de socios' }, { status: 403 })
    }

    const [salesRes, collRes, refundsRes, expensesRes, commissionsRes, partnersRes] = await Promise.all([
      sb
        .from('sales')
        .select('gross_amount, discount, status, sale_date')
        .eq('tenant_id', t.tenantId)
        .range(0, FINANCE_QUERY_ROW_CAP),
      sb
        .from('collections')
        .select('id, gross_amount, processing_fee, collected_at, status')
        .eq('tenant_id', t.tenantId)
        .range(0, FINANCE_QUERY_ROW_CAP),
      sb
        .from('refunds')
        .select('gross_refund_amount, refund_date')
        .eq('tenant_id', t.tenantId)
        .range(0, FINANCE_QUERY_ROW_CAP),
      sb
        .from('expenses')
        .select('amount, category, expense_date')
        .eq('tenant_id', t.tenantId)
        .range(0, FINANCE_QUERY_ROW_CAP),
      sb
        .from('commissions')
        .select('commission_amount, direction, collection_id, liquidation_month')
        .eq('tenant_id', t.tenantId)
        .range(0, FINANCE_QUERY_ROW_CAP),
      sb.from('partners').select('id, name, profit_percent, user_id').eq('tenant_id', t.tenantId).eq('is_active', true),
    ])

    const pnl = computeMonthlyPnl(ym, {
      sales: salesRes.data ?? [],
      collections: collRes.data ?? [],
      refunds: refundsRes.data ?? [],
      expenses: expensesRes.data ?? [],
      commissions: commissionsRes.data ?? [],
    })

    const partners = (partnersRes.data ?? []) as {
      id: string
      name: string
      profit_percent: number | string
      user_id: string | null
    }[]
    const reparto = calcularRepartoSocios(
      pnl.preTaxProfit,
      partners.map((p) => ({ id: p.id, name: p.name, profitPercent: Number(p.profit_percent) }))
    )

    if (isLead) {
      return NextResponse.json({ ym, ...reparto })
    }

    // Socio sin rol de dirección: solo su propia fila, nunca el beneficio total de la empresa ni
    // el reparto de los demás socios.
    const mia = reparto.socios.find((s) => partners.find((p) => p.id === s.id)?.user_id === t.userId)
    return NextResponse.json({ ym, socios: mia ? [mia] : [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
