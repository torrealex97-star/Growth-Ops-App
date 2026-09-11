import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { generateCommissionsForCollection, saleNeedsCommissionReview } from '@/lib/commissions/generate'
import { resolveSaleAttribution } from '@/lib/commissions/attribution'
import { notifyCreatuagenteVenta, resolveSaleToken } from '@/lib/creatuagente'
import type { Collection, Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// Registra un cobro (cash collected) para una venta y genera sus comisiones pendientes.
// Se usa desde el alta/completar de ventas (reserva ya pagada, entrada, resto de un full-pay).
// Va por service role porque `collections`/`commissions` solo permiten INSERT a admin/director
// vía RLS, pero un closer/setter sí puede crear ventas.
export async function POST(req: NextRequest) {
  try {
    const { saleId, grossAmount, method, collectedAt, commissionableAmount } = await req.json()
    const amount = Number(grossAmount)
    if (!saleId || !amount || amount <= 0) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }
    // Comisionable explícito (opcional): para cobros donde el importe ya ES la parte comisionable
    // y NO hay que re-aplicar el ratio del plan (p.ej. el adelanto de Sequra, que recibimos neto).
    const explicitCommissionable = commissionableAmount != null ? Number(commissionableAmount) : null

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: sale } = await sb
      .from('sales')
      .select('id, contact_id, appointment_id, setter_id, closer_id, affiliate_id, affiliate_commission_percent, notes, payment_plans(cash_collection_ratio, fee_percent, method)')
      .eq('id', saleId)
      .single()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    // Si la venta no tiene setter/afiliado, dedúcelos de la atribución del contacto (utm_term →
    // tracking_code del setter/cold caller, utm_content → affiliate_code) y aplícalo a la venta
    // ANTES de generar comisiones, para que el rep atribuido por UTM cobre su comisión.
    const attrPatch = await resolveSaleAttribution(sb, sale as unknown as Parameters<typeof resolveSaleAttribution>[1])
    Object.assign(sale, attrPatch)

    const plan = sale.payment_plans as { cash_collection_ratio?: number; fee_percent?: number; method?: string | null } | null
    const ratio = Number(plan?.cash_collection_ratio ?? 1)
    const feePercent = Number(plan?.fee_percent ?? 0)
    const now = collectedAt ? new Date(collectedAt).toISOString() : new Date().toISOString()
    const round2 = (n: number) => Math.round(n * 100) / 100

    // Plan personalizado: si esta venta ya tiene un cobro elegible previo (p.ej. esta ruta se
    // reutiliza para un segundo adelanto), este cobro queda en revisión en vez de comisionar ya.
    const needsReview = await saleNeedsCommissionReview(sb, saleId, plan?.method)

    // Antes de insertar: si esta venta no tenía NINGÚN cobro previo, este es el primero
    // (equivale a "venta creada" de cara a creatuagente, que no ve el alta de la venta en sí,
    // solo el cobro).
    const { count: priorCollections } = await sb
      .from('collections')
      .select('id', { count: 'exact', head: true })
      .eq('sale_id', saleId)
    const isFirstCollection = !priorCollections

    const { data: coll, error: collErr } = await sb.from('collections').insert({
      sale_id: saleId,
      expected_installment_id: null,
      collected_at: now,
      gross_amount: round2(amount),
      commissionable_amount: round2(explicitCommissionable != null ? explicitCommissionable : amount * ratio),
      processing_fee: round2(amount * (feePercent / 100)),
      is_confirmed: true,
      is_eligible_for_commission: !needsReview,
      eligible_at: needsReview ? null : now,
      needs_commission_review: needsReview,
      status: 'collected',
      payment_method: method || null,
    }).select().single()

    if (collErr || !coll) {
      return NextResponse.json({ error: collErr?.message || 'No se pudo registrar el cobro' }, { status: 500 })
    }

    const commissionsGenerated = needsReview
      ? 0
      : await generateCommissionsForCollection(sb, coll as Collection, sale as unknown as Sale)

    // Fire-and-forget: no debe tumbar el registro del cobro (ya aplicado arriba) si
    // creatuagente está caído o el lead no tiene token. Un solo evento venta.registrada
    // por venta, en el primer cobro (cobros posteriores de la misma venta no reenvían nada:
    // no hay evento confirmado para "cobro adicional").
    if (isFirstCollection) {
      const token = await resolveSaleToken(sb, sale.appointment_id)
      await notifyCreatuagenteVenta(token, {
        idExterno: saleId, importe: round2(amount), moneda: 'EUR', fecha: now, notas: sale.notes || undefined,
      })
    }

    return NextResponse.json({ ok: true, commissionsGenerated, needsReview })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
