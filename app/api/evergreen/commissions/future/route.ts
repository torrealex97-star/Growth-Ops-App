import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { pickCommissionRule } from '@/lib/commissions/calculator'
import { repNetCash } from '@/lib/commissions/generate'
import { tramoIdByReps } from '@/lib/commissions/tramos'
import type { CommissionRule } from '@/lib/types/database'

export const runtime = 'nodejs'

// Comisiones FUTURAS (esperadas / por cobrar): proyecta la comisión de las cuotas que el cliente
// aún tiene que pagar (autofinanciado / entrada Sequra). NO son comisión ganada todavía (eso pasa
// al cobrarse cada cuota), pero se muestran para que el equipo vea en tiempo real lo que le queda
// por cobrar. Se calculan sobre el comisionable de la cuota × el % del TRAMO actual del rep.
// Visibilidad: admin/director/manager ven todo; el resto solo lo suyo.
export async function GET() {
  try {
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key ?? ''
    const canSeeAll = ['admin', 'director', 'manager'].includes(role)

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: rulesData } = await sb.from('commission_rules').select('*').eq('is_active', true)
    const rules = (rulesData ?? []) as CommissionRule[]

    // Cuotas aún no cobradas (pendientes/vencidas), sin monitorización, de ventas activas
    const { data: insts } = await sb
      .from('sale_expected_installments')
      .select('id, due_date, expected_commissionable_amount, sales!inner(id, setter_id, closer_id, affiliate_id, affiliate_commission_percent, status, contacts(full_name))')
      .in('status', ['pending', 'overdue'])
      .eq('is_monitoring', false)
      .eq('sales.status', 'active')

    // Cuotas de un plan personalizado YA cobradas pero en revisión manual de cobros: siguen sin
    // comisión real hasta que el equipo las apruebe, así que se proyectan aquí igual que las
    // pendientes (ver /api/evergreen/collections/approve-review para la aprobación).
    const { data: reviewColls } = await sb
      .from('collections')
      .select('id, collected_at, commissionable_amount, sales!inner(id, setter_id, closer_id, affiliate_id, affiliate_commission_percent, status, contacts(full_name))')
      .eq('needs_commission_review', true)
      .eq('status', 'collected')
      .eq('sales.status', 'active')

    // Nombres de usuarios
    const { data: users } = await sb.from('users').select('id, full_name')
    const nameOf = new Map((users ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]))

    // Tramo/nivel actual por rep (para reglas de comisión enlazadas a un tramo), igual que en generate.ts
    const repIdsForTramo = [
      ...(insts ?? []).flatMap((raw) => {
        const inst = raw as unknown as { sales: { setter_id: string | null; closer_id: string | null } }
        return [inst.sales.setter_id, inst.sales.closer_id]
      }),
      ...(reviewColls ?? []).flatMap((raw) => {
        const c = raw as unknown as { sales: { setter_id: string | null; closer_id: string | null } }
        return [c.sales.setter_id, c.sales.closer_id]
      }),
    ]
    const tramoByRep = await tramoIdByReps(sb, repIdsForTramo)

    const now = new Date()
    const rateCache = new Map<string, number>() // `${rep}|${role}` -> percent
    const getRate = async (repId: string, r: 'setter' | 'closer') => {
      const key = `${repId}|${r}`
      if (rateCache.has(key)) return rateCache.get(key)!
      const total = await repNetCash(sb, repId, r)
      const rule = pickCommissionRule(rules, r, repId, now, total, tramoByRep[repId] ?? null)
      const percent = rule?.percent ?? (r === 'setter' ? 5 : 10)
      rateCache.set(key, percent)
      return percent
    }

    type Row = {
      installmentId: string; saleId: string; contact: string; dueDate: string
      userId: string; userName: string; participantType: 'setter' | 'closer' | 'affiliate'
      base: number; percent: number; amount: number
      source: 'installment' | 'review'; collectionId?: string
    }
    const rows: Row[] = []

    type SaleRel = { id: string; setter_id: string | null; closer_id: string | null; affiliate_id: string | null; affiliate_commission_percent: number | null; contacts?: { full_name?: string } | { full_name?: string }[] | null }

    const addRowsFor = async (
      sale: SaleRel, base: number, dueDate: string, instId: string,
      source: 'installment' | 'review', collectionId?: string
    ) => {
      if (base <= 0) return
      const contactRel = Array.isArray(sale.contacts) ? sale.contacts[0] : sale.contacts
      const contact = contactRel?.full_name ?? '—'

      const add = async (repId: string | null, pType: 'setter' | 'closer' | 'affiliate', fixedPercent?: number | null) => {
        if (!repId) return
        if (!canSeeAll && repId !== user.id) return
        const percent = pType === 'affiliate' ? Number(fixedPercent ?? 0) : await getRate(repId, pType)
        if (!percent) return
        rows.push({
          installmentId: instId, saleId: sale.id, contact, dueDate,
          userId: repId, userName: nameOf.get(repId) ?? '—', participantType: pType,
          base, percent, amount: Math.round(base * percent) / 100,
          source, collectionId,
        })
      }

      await add(sale.setter_id, 'setter')
      await add(sale.closer_id, 'closer')
      await add(sale.affiliate_id, 'affiliate', sale.affiliate_commission_percent)
    }

    type InstRow = { id: string; due_date: string; expected_commissionable_amount: number | string; sales: SaleRel }
    for (const raw of insts ?? []) {
      const inst = raw as unknown as InstRow
      await addRowsFor(inst.sales, Number(inst.expected_commissionable_amount || 0), inst.due_date, inst.id, 'installment')
    }

    type ReviewRow = { id: string; collected_at: string; commissionable_amount: number | string; sales: SaleRel }
    for (const raw of reviewColls ?? []) {
      const c = raw as unknown as ReviewRow
      await addRowsFor(c.sales, Number(c.commissionable_amount || 0), c.collected_at, c.id, 'review', c.id)
    }

    const total = rows.reduce((s, r) => s + r.amount, 0)
    return NextResponse.json({ ok: true, rows, total })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
