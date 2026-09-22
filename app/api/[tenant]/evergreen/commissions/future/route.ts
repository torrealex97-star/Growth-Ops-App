import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { pickCommissionRule } from '@/lib/commissions/calculator'
import { repNetCash } from '@/lib/commissions/generate'
import { tramoIdByReps } from '@/lib/commissions/tramos'
import { resolverScopeColaborador } from '@/lib/collaborators/scope'
import type { CommissionRule } from '@/lib/types/database'

export const runtime = 'nodejs'

// Comisiones FUTURAS (esperadas / por cobrar): proyecta la comisión de las cuotas que el cliente
// aún tiene que pagar (autofinanciado / entrada Sequra). NO son comisión ganada todavía (eso pasa
// al cobrarse cada cuota), pero se muestran para que el equipo vea en tiempo real lo que le queda
// por cobrar. Se calculan sobre el comisionable de la cuota × el % del TRAMO actual del rep.
// Visibilidad: admin/director/manager ven todo; el resto solo lo suyo.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role ?? ''
    const canSeeAll = ['admin', 'director', 'manager'].includes(role)

    const { data: rulesData } = await sb
      .from('commission_rules')
      .select('*')
      .eq('is_active', true)
      .eq('tenant_id', t.tenantId)
    const rules = (rulesData ?? []) as CommissionRule[]

    const HOY = new Date().toISOString().split('T')[0]

    // Cuotas aún no cobradas (pendientes/vencidas), sin monitorización, de ventas activas
    const { data: insts } = await sb
      .from('sale_expected_installments')
      .select(
        'id, due_date, expected_commissionable_amount, sales!inner(id, setter_id, closer_id, affiliate_id, affiliate_commission_percent, status, tenant_id, contacts(full_name))'
      )
      .in('status', ['pending', 'overdue'])
      .eq('is_monitoring', false)
      .eq('sales.status', 'active')
      .eq('sales.tenant_id', t.tenantId)

    // PREVISIÓN DERIVADA: la mayoría de ventas históricas no tiene calendario materializado
    // (sale_expected_installments vacío), pero SÍ cuotas mensuales reales por pagar. Se deriva
    // del plan de la venta (installments_count) cubierto FIFO por sus cobros reales — el mismo
    // criterio canónico de lib/sales/plan-cuotas.ts (planCuotasDeVenta, rama previsión).
    const ventasConCalendario = new Set((insts ?? []).map((r) => (r as unknown as { sales: { id: string } }).sales.id))
    const { data: ventasSinCalendario } = await sb
      .from('sales')
      .select(
        'id, sale_date, gross_amount, installments_count, installments_start_date, setter_id, closer_id, affiliate_id, affiliate_commission_percent, contacts(full_name)'
      )
      .eq('status', 'active')
      .eq('tenant_id', t.tenantId)
    const idsSinCal = (ventasSinCalendario ?? []).filter((v) => !ventasConCalendario.has(v.id)).map((v) => v.id)
    const { data: cobrosSinCal } = idsSinCal.length
      ? await sb
          .from('collections')
          .select('sale_id, gross_amount, collected_at, status')
          .in('sale_id', idsSinCal)
          .eq('status', 'collected')
          .eq('tenant_id', t.tenantId)
      : { data: [] }
    const cobrosPorVenta = new Map<string, { bruto: number; fecha: string }[]>()
    for (const c of (cobrosSinCal ?? []) as {
      sale_id: string
      gross_amount: number | string
      collected_at: string
    }[]) {
      const lista = cobrosPorVenta.get(c.sale_id) ?? []
      lista.push({ bruto: Number(c.gross_amount || 0), fecha: c.collected_at })
      cobrosPorVenta.set(c.sale_id, lista)
    }
    // Plan de pago de esas ventas (método 'reserva' = 1 sola cuota, igual que planCuotasDeVenta).
    const { data: planesSinCal } = idsSinCal.length
      ? await sb.from('payment_plans').select('sale_id, number_of_payments, method').in('sale_id', idsSinCal)
      : { data: [] }
    const planDe = new Map<string, { number_of_payments: number | null; method: string | null }>()
    for (const p of (planesSinCal ?? []) as {
      sale_id: string
      number_of_payments: number | null
      method: string | null
    }[]) {
      planDe.set(p.sale_id, p)
    }

    // Cuotas de un plan personalizado YA cobradas pero en revisión manual de cobros: siguen sin
    // comisión real hasta que el equipo las apruebe, así que se proyectan aquí igual que las
    // pendientes (ver /api/${tenant}/evergreen/collections/approve-review para la aprobación).
    const { data: reviewColls } = await sb
      .from('collections')
      .select(
        'id, collected_at, commissionable_amount, sales!inner(id, setter_id, closer_id, affiliate_id, affiliate_commission_percent, status, tenant_id, contacts(full_name))'
      )
      .eq('needs_commission_review', true)
      .eq('status', 'collected')
      .eq('sales.status', 'active')
      .eq('sales.tenant_id', t.tenantId)

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
    const tramoByRep = await tramoIdByReps(sb, t.tenantId, repIdsForTramo)

    const now = new Date()
    // SCOPE DE COLABORADOR (§55): su proyección futura solo trae SU lane (affiliate) — las
    // proyecciones setter/closer de las ventas de sus contactos son datos de otros lanes.
    let esColaborador = false
    if (!canSeeAll) {
      const scope = await resolverScopeColaborador(sb, t.userId, t.tenantId)
      esColaborador = scope.tipo === 'collaborator'
    }
    const rateCache = new Map<string, number>() // `${rep}|${role}` -> percent
    const getRate = async (repId: string, r: 'setter' | 'closer') => {
      const key = `${repId}|${r}`
      if (rateCache.has(key)) return rateCache.get(key)!
      const total = await repNetCash(sb, t.tenantId, repId, r)
      const rule = pickCommissionRule(rules, r, repId, now, total, tramoByRep[repId] ?? null)
      const percent = rule?.percent ?? (r === 'setter' ? 5 : 10)
      rateCache.set(key, percent)
      return percent
    }

    type Row = {
      installmentId: string
      saleId: string
      contact: string
      dueDate: string
      userId: string
      userName: string
      participantType: 'setter' | 'closer' | 'affiliate'
      base: number
      percent: number
      amount: number
      source: 'installment' | 'review'
      estado: 'pending' | 'overdue' | 'review'
      collectionId?: string
    }
    const rows: Row[] = []

    type SaleRel = {
      id: string
      setter_id: string | null
      closer_id: string | null
      affiliate_id: string | null
      affiliate_commission_percent: number | null
      contacts?: { full_name?: string } | { full_name?: string }[] | null
    }

    const addRowsFor = async (
      sale: SaleRel,
      base: number,
      dueDate: string,
      instId: string,
      source: 'installment' | 'review',
      estado: 'pending' | 'overdue' | 'review',
      collectionId?: string
    ) => {
      if (base <= 0) return
      const contactRel = Array.isArray(sale.contacts) ? sale.contacts[0] : sale.contacts
      const contact = contactRel?.full_name ?? '—'

      const add = async (
        repId: string | null,
        pType: 'setter' | 'closer' | 'affiliate',
        fixedPercent?: number | null
      ) => {
        if (!repId) return
        if (!canSeeAll && repId !== t.userId) return
        // El colaborador no proyecta lanes setter/closer (ni siquiera las de "sus" ventas):
        // esas proyecciones pertenecen a otros miembros y expondrían sus importes.
        if (esColaborador && (pType === 'setter' || pType === 'closer')) return
        const percent = pType === 'affiliate' ? Number(fixedPercent ?? 0) : await getRate(repId, pType)
        if (!percent) return
        rows.push({
          installmentId: instId,
          saleId: sale.id,
          contact,
          dueDate,
          userId: repId,
          userName: nameOf.get(repId) ?? '—',
          participantType: pType,
          base,
          percent,
          amount: Math.round(base * percent) / 100,
          source,
          estado,
          collectionId,
        })
      }

      await add(sale.setter_id, 'setter')
      await add(sale.closer_id, 'closer')
      await add(sale.affiliate_id, 'affiliate', sale.affiliate_commission_percent)
    }

    type InstRow = {
      id: string
      due_date: string
      expected_commissionable_amount: number | string
      status: string
      sales: SaleRel
    }
    for (const raw of insts ?? []) {
      const inst = raw as unknown as InstRow
      await addRowsFor(
        inst.sales,
        Number(inst.expected_commissionable_amount || 0),
        inst.due_date,
        inst.id,
        'installment',
        // Vencida sin cobrar = impago real, aunque el cron aún no la haya pasado a overdue
        // (mismo criterio que planCuotasDeVenta: la vista nunca pinta cobrado lo vencido).
        inst.status === 'overdue' || inst.due_date < HOY ? 'overdue' : 'pending'
      )
    }

    type ReviewRow = { id: string; collected_at: string; commissionable_amount: number | string; sales: SaleRel }
    for (const raw of reviewColls ?? []) {
      const c = raw as unknown as ReviewRow
      await addRowsFor(c.sales, Number(c.commissionable_amount || 0), c.collected_at, c.id, 'review', 'review', c.id)
    }

    // Cuotas derivadas (previsión) de las ventas sin calendario materializado: mismas firmas
    // (setter/closer/afiliado), source 'installment' y due_date del mes que toca — así el
    // desglose mensual del dashboard las agrupa igual que las reales.
    for (const v of ventasSinCalendario ?? []) {
      if (ventasConCalendario.has(v.id)) continue
      const plan = planDe.get(v.id) ?? null
      // Reserva: 1 cuota (el pago de reserva cubre la venta), igual que planCuotasDeVenta.
      const n = plan?.method === 'reserva' ? 1 : Math.max(1, v.installments_count ?? plan?.number_of_payments ?? 1)
      const bruto = Number(v.gross_amount || 0)
      if (!(bruto > 0)) continue
      const per = Math.floor((bruto / n) * 100) / 100
      const importes: number[] = []
      let asignado = 0
      for (let i = 0; i < n; i++) {
        const importe = i === n - 1 ? Math.round((bruto - asignado) * 100) / 100 : per
        asignado += per
        importes.push(importe)
      }
      // Cuota 1 = fecha de venta; siguientes mensuales desde installments_start_date (si hay,
      // el resto arranca ahí) o desde la venta — criterio exacto de planCuotasDeVenta.
      const fechaVenta = (v.sale_date || '').split('T')[0]
      const inicioCuotas = v.installments_start_date || fechaVenta
      const fechas: string[] = []
      for (let i = 0; i < n; i++) {
        if (i === 0) {
          fechas.push(fechaVenta)
          continue
        }
        const d = new Date(inicioCuotas + 'T00:00:00Z')
        d.setUTCMonth(d.getUTCMonth() + (v.installments_start_date ? i - 1 : i))
        fechas.push(d.toISOString().split('T')[0])
      }
      // FIFO: los cobros reales cubren las cuotas previstas en orden.
      const restantes = [...importes]
      const cobros = (cobrosPorVenta.get(v.id) ?? []).sort(
        (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
      )
      for (const cobro of cobros) {
        let resto = cobro.bruto
        for (let i = 0; i < restantes.length && resto > 0.005; i++) {
          const aplicado = Math.min(resto, restantes[i])
          restantes[i] -= aplicado
          resto -= aplicado
        }
      }
      const saleRel: SaleRel = {
        id: v.id,
        setter_id: v.setter_id,
        closer_id: v.closer_id,
        affiliate_id: v.affiliate_id,
        affiliate_commission_percent: v.affiliate_commission_percent,
        contacts: v.contacts,
      }
      for (let i = 0; i < n; i++) {
        if (!(restantes[i] > 0.005)) continue
        // Vencida sin cobrar = impago real (estado 'overdue'): la proyección la incluye para
        // el KPI de impagos, pero nunca cuenta como comisión futura del mes en curso.        // Vencida sin cobrar = impago real (estado 'overdue'): la proyección la incluye para
        // el KPI de impagos, pero nunca cuenta como comisión futura del mes en curso.
        const vencida = fechas[i] < HOY
        await addRowsFor(
          saleRel,
          restantes[i],
          fechas[i],
          `${v.id}#${i + 1}`,
          'installment',
          vencida ? 'overdue' : 'pending'
        )
      }
    }

    const total = rows.reduce((s, r) => s + r.amount, 0)
    return NextResponse.json({ ok: true, rows, total })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
