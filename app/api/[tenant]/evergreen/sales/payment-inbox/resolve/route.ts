import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { stripeGet } from '@/lib/stripe/client'
import type { StripeIntent } from '@/lib/finance/stripeReconciliation'
import { readPaymentInbox } from '@/lib/sales/payment-inbox'
import { addDaysIso, REFUND_WINDOW_DAYS } from '@/lib/finance/stripeImport'
import { buildRestInstallments } from '@/lib/commissions/calculator'
import { generateCommissionsForCollection } from '@/lib/commissions/generate'
import type { Sale, Collection } from '@/lib/types/database'
import { resolveSaleAttribution } from '@/lib/commissions/attribution'

export const runtime = 'nodejs'
export const maxDuration = 60
const schema = z.object({
  paymentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  saleId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  grossAmount: z.number().positive().max(10000000).optional(),
  saleDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  restCount: z.number().int().min(0).max(120).default(0),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && !['admin', 'director', 'closer'].includes(session.role ?? ''))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Revisa los datos de la venta.' }, { status: 400 })
  const body = parsed.data
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const closer = session.role === 'closer' && !session.isSuperAdmin ? session.userId : null
    const rows = await readPaymentInbox(sb, session.tenantId, closer)
    const payment = rows.find((r) => r.payment_id === body.paymentId)
    if (!payment) return fail('Este pago ya se ha registrado o no está asignado a ti. Actualiza la bandeja.', 409)
    if (!payment.contactId) return fail('Identifica primero un único contacto con este email en CRM.')
    // Verify the current provider state, including currency, refunds and actual processing fees.
    const cfg = await getTenantConfigWithFallback(session.tenantId, true)
    if (!cfg.STRIPE_SECRET_KEY) return fail('Stripe no está configurado.', 503)
    const intent = await stripeGet<StripeIntent & { customer?: string | null }>(
      `payment_intents/${encodeURIComponent(body.paymentId)}`,
      new URLSearchParams([['expand[]', 'latest_charge.balance_transaction']]),
      { secretKey: cfg.STRIPE_SECRET_KEY, accountId: cfg.STRIPE_ACCOUNT_ID }
    )
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    const txn = typeof charge?.balance_transaction === 'object' ? charge.balance_transaction : null
    if (
      intent.status !== 'succeeded' ||
      intent.currency.toLowerCase() !== 'eur' ||
      !charge ||
      charge.disputed ||
      charge.refunded ||
      Number(charge.amount_refunded) > 0
    )
      return fail('Este pago requiere revisión financiera por su moneda, estado o devolución.')
    const amount = intent.amount_received / 100
    const fee = txn?.fee == null ? null : txn.fee / 100
    if (!Number.isFinite(amount) || amount <= 0 || fee === null || !Number.isFinite(fee) || fee < 0 || fee > amount)
      return fail('Falta confirmar el importe o la comisión real de Stripe. Reintenta más tarde.')
    const email = (intent.receipt_email || charge.billing_details?.email || '').trim().toLowerCase()
    const providerCustomer = typeof intent.customer === 'string' ? intent.customer : null
    const customerMatches =
      payment.identitySource === 'customer' && !!payment.customer_id && providerCustomer === payment.customer_id
    if (!customerMatches && (!email || email !== payment.customer_email?.trim().toLowerCase()))
      return fail('La identidad del cobro ha cambiado; revisa el contacto.')
    let newSale: Record<string, unknown> | null = null
    let installments: unknown[] = []
    if (body.saleId) {
      const { data: sale, error } = await sb
        .from('sales')
        .select('id,contact_id,closer_id,status')
        .eq('tenant_id', session.tenantId)
        .eq('id', body.saleId)
        .maybeSingle()
      if (error) throw error
      if (
        !sale ||
        sale.contact_id !== payment.contactId ||
        sale.status !== 'active' ||
        (closer && sale.closer_id !== closer)
      )
        return fail('La venta no pertenece a este contacto o no tienes acceso.', 403)
    } else {
      if (!body.planId || !body.productId || !body.grossAmount || !body.saleDate)
        return fail('Elige producto, plan, fecha e importe total pactado.')
      const { data: plan, error } = await sb
        .from('payment_plans')
        .select('id,product_id,method,cash_collection_ratio')
        .eq('tenant_id', session.tenantId)
        .eq('id', body.planId)
        .eq('is_active', true)
        .maybeSingle()
      if (error) throw error
      if (!plan || plan.product_id !== body.productId) return fail('El plan no corresponde al producto.')
      if ((plan.method ?? '') === 'sequra')
        return fail('La financiación externa (Sequra) se completa desde el registro habitual de ventas.')
      if ((plan.method ?? '') === 'reserva') {
        // Una reserva se registra POR SU ANTICIPO: el total pactado es exactamente el cobro recibido
        // (la reserva no lleva cuotas; el plan final y el primer pago se eligen al completarla).
        if (Math.abs(body.grossAmount - amount) > 0.01)
          return fail('La reserva se registra por el anticipo recibido; el plan final se elige al completar el pago.')
        if (body.restCount > 0 || body.startDate)
          return fail('Una reserva no lleva cuotas: el resto del plan se configura al completar el pago.')
      }
      const validDate = (s: string) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
      if (!validDate(body.saleDate) || body.saleDate > new Date().toISOString().slice(0, 10))
        return fail('Fecha de venta inválida.')
      if (body.grossAmount < amount) return fail('El total pactado no puede ser menor que este cobro.')
      const remaining = Math.round((body.grossAmount - amount) * 100) / 100
      if (remaining > 0 && (!body.restCount || !body.startDate || !validDate(body.startDate)))
        return fail('Indica cuántas cuotas quedan y la fecha de la siguiente.')
      const { data: agendas, error: agendaError } = await sb
        .from('appointments')
        .select('closer_id,setter_id')
        .eq('tenant_id', session.tenantId)
        .eq('contact_id', payment.contactId)
        .order('appointment_datetime', { ascending: false })
        .limit(1)
      if (agendaError) throw agendaError
      newSale = {
        contact_id: payment.contactId,
        product_id: body.productId,
        payment_plan_id: body.planId,
        gross_amount: body.grossAmount,
        sale_date: body.saleDate,
        refund_deadline_at: addDaysIso(body.saleDate, REFUND_WINDOW_DAYS),
        closer_id: closer ?? agendas?.[0]?.closer_id ?? null,
        setter_id: agendas?.[0]?.setter_id ?? null,
        installments_count: remaining > 0 ? body.restCount : null,
        installments_start_date: remaining > 0 ? body.startDate : null,
      }
      if (remaining > 0)
        installments = buildRestInstallments({
          saleId: '',
          totalGross: body.grossAmount,
          cashCollectionRatio: Number(plan.cash_collection_ratio),
          alreadyPaid: amount,
          restCount: body.restCount,
          startDate: body.startDate!,
        })
    }
    const { data, error } = await sb.rpc('resolve_payment_inbox', {
      p_tenant: session.tenantId,
      p_actor: session.userId,
      p_payment: intent.id,
      p_charge: charge.id,
      p_amount: amount,
      p_fee: fee,
      p_paid_at: new Date(intent.created * 1000).toISOString(),
      p_sale_id: body.saleId ?? null,
      p_new_sale: newSale,
      p_installments: installments,
    })
    if (error?.message.includes('PENDING_MANUAL_MATCH'))
      return fail('Hay un cobro manual similar sin referencia. Revísalo en Conciliación antes de registrar otro.', 409)
    if (error) return fail('No se pudo registrar el cobro. No se ha creado una venta parcial. Reintenta.', 503)
    // The committed receipt is recoverable even if commission processing fails.
    let warning: string | null = null
    if (!data.alreadyRecorded) {
      try {
        const [saleResult, collectionResult] = await Promise.all([
          sb.from('sales').select('*').eq('tenant_id', session.tenantId).eq('id', data.saleId).single(),
          sb.from('collections').select('*').eq('tenant_id', session.tenantId).eq('id', data.collectionId).single(),
        ])
        if (saleResult.error || collectionResult.error) throw new Error('No se pudo cargar el registro')
        const sale = saleResult.data as Sale
        Object.assign(sale, await resolveSaleAttribution(sb, sale, session.tenantId))
        const collection = collectionResult.data as Collection
        if (collection.needs_commission_review)
          warning =
            'Cobro registrado. Revisa las comisiones y, si es una reserva, completa su producto y plan desde la venta.'
        else await generateCommissionsForCollection(sb, session.tenantId, collection, sale)
      } catch {
        const { error: reviewError } = await sb
          .from('collections')
          .update({ needs_commission_review: true, is_eligible_for_commission: false, eligible_at: null })
          .eq('tenant_id', session.tenantId)
          .eq('id', data.collectionId)
        warning = reviewError
          ? 'Cobro registrado. No se pudo generar ni marcar la revisión de comisiones; requiere revisión administrativa.'
          : 'Cobro registrado. Comisiones pendientes de revisión.'
      }
    }
    return NextResponse.json({ ...data, warning })
  } catch {
    return fail('No se pudo verificar el cobro. Actualiza la bandeja antes de reintentar.', 503)
  }
}
