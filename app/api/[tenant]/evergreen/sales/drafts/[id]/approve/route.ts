import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { buildCollection, buildSaleFromPayment, type ImportChoice } from '@/lib/finance/stripeImport'
import type { BackfillRow } from '@/lib/finance/stripeBackfill'
import { reconcileSaleCommissions } from '@/lib/commissions/generate'

export const runtime = 'nodejs'

// APRUEBA una venta borrador (ver migración 20260928120000_sale_drafts.sql y
// lib/finance/stripeSaleDrafts.ts). Es lo ÚNICO que puede convertir una sugerencia en una fila real
// de `sales`/`collections` — el webhook solo sugiere, nunca escribe dinero.
//
// DOS CAMINOS, elegidos por quien aprueba, nunca adivinados:
//   - `{ saleId }`: el pago es una CUOTA de una venta que YA EXISTE (normalmente la que sugirió
//     existing_sale_id). Se escribe solo el cobro.
//   - `{ productId, paymentPlanId }`: el pago es una venta NUEVA. Se escribe la venta y su cobro,
//     igual que hace el registro manual (lib/finance/stripeImport.ts).

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireFinanceAdmin(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return { error: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }) }
  }
  return session
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id: draftId } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const body = (await req.json().catch(() => ({}))) as {
    saleId?: string
    productId?: string
    paymentPlanId?: string
  }

  const sb = serviceClient()

  const { data: draft, error: draftErr } = await sb
    .from('sale_drafts')
    .select('*')
    .eq('id', draftId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle()
  if (draftErr) return NextResponse.json({ error: draftErr.message }, { status: 500 })
  if (!draft) return NextResponse.json({ error: 'Borrador no encontrado' }, { status: 404 })
  if (draft.status !== 'pending') {
    return NextResponse.json(
      { error: `Este borrador ya está ${draft.status === 'approved' ? 'aprobado' : 'rechazado'}` },
      { status: 409 }
    )
  }
  if (!draft.contact_id) {
    return NextResponse.json({ error: 'Este borrador no tiene contacto identificado' }, { status: 400 })
  }

  // Releída de última hora: entre que se listó y se pulsó aprobar, el pago puede haberse registrado
  // por otra vía (backfill manual, doble clic en dos pestañas). No se confía en lo que trajo el listado.
  const { data: yaRegistrado } = await sb
    .from('collections')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('payment_reference', draft.payment_reference)
    .maybeSingle()
  if (yaRegistrado) {
    await sb.from('sale_drafts').update({ status: 'rejected', reason: 'Ya registrado por otra vía' }).eq('id', draftId)
    return NextResponse.json(
      { error: 'Este pago ya se había registrado por otra vía. El borrador se ha cerrado.' },
      { status: 409 }
    )
  }

  const row: BackfillRow = {
    paymentId: draft.payment_reference,
    createdAt: draft.occurred_at,
    amount: draft.amount,
    currency: draft.currency,
    email: draft.email,
    verdict: 'registrable',
    reason: '',
    contactId: draft.contact_id,
  }

  let saleId: string
  let esVentaNueva: boolean

  if (body.saleId) {
    // CAMINO 1 — cuota de una venta existente.
    const { data: venta, error: ventaErr } = await sb
      .from('sales')
      .select('id, contact_id, payment_plan_id')
      .eq('tenant_id', session.tenantId)
      .eq('id', body.saleId)
      .maybeSingle()
    if (ventaErr) return NextResponse.json({ error: ventaErr.message }, { status: 500 })
    if (!venta) return NextResponse.json({ error: 'Esa venta no es de esta subcuenta' }, { status: 400 })
    if (venta.contact_id !== draft.contact_id) {
      return NextResponse.json({ error: 'Esa venta no es del mismo contacto que el pago' }, { status: 400 })
    }
    const { data: plan, error: planErr } = await sb
      .from('payment_plans')
      .select('cash_collection_ratio, method')
      .eq('id', venta.payment_plan_id)
      .maybeSingle()
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 500 })

    const choice: ImportChoice = {
      productId: '',
      paymentPlanId: venta.payment_plan_id,
      cashCollectionRatio: (plan?.cash_collection_ratio as number | undefined) ?? 1,
      planGrossPrice: null,
      paymentMethod: (plan?.method as string | null | undefined) ?? null,
      tenantId: session.tenantId,
      userId: session.userId,
    }
    const collection = await sb
      .from('collections')
      .insert(buildCollection(row, venta.id, choice))
      .select('id')
      .single()
    if (collection.error) {
      const yaEstaba = collection.error.code === '23505'
      return NextResponse.json(
        {
          error: yaEstaba
            ? 'Este pago ya se había registrado (otra petición llegó antes). No se ha duplicado nada.'
            : `No se pudo registrar el cobro: ${collection.error.message}`,
        },
        { status: yaEstaba ? 409 : 500 }
      )
    }
    saleId = venta.id
    esVentaNueva = false
  } else {
    // CAMINO 2 — venta nueva.
    if (!body.productId || !body.paymentPlanId) {
      return NextResponse.json(
        { error: 'Falta elegir producto y plan de pago, o una venta existente' },
        { status: 400 }
      )
    }
    const [product, plan] = await Promise.all([
      sb.from('products').select('id').eq('tenant_id', session.tenantId).eq('id', body.productId).maybeSingle(),
      sb
        .from('payment_plans')
        .select('id, method, cash_collection_ratio, gross_price')
        .eq('tenant_id', session.tenantId)
        .eq('id', body.paymentPlanId)
        .maybeSingle(),
    ])
    if (!product.data) return NextResponse.json({ error: 'Ese producto no es de esta subcuenta' }, { status: 400 })
    if (!plan.data) return NextResponse.json({ error: 'Ese plan de pago no es de esta subcuenta' }, { status: 400 })
    const planRow = plan.data as {
      cash_collection_ratio: number | null
      gross_price: number | null
      method: string | null
    }

    const choice: ImportChoice = {
      productId: body.productId,
      paymentPlanId: body.paymentPlanId,
      cashCollectionRatio: planRow.cash_collection_ratio ?? 1,
      planGrossPrice: planRow.gross_price ?? null,
      paymentMethod: planRow.method,
      tenantId: session.tenantId,
      userId: session.userId,
    }
    const built = buildSaleFromPayment(row, choice)
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 })

    const inserted = await sb.from('sales').insert(built.sale).select('id').single()
    if (inserted.error || !inserted.data) {
      return NextResponse.json({ error: inserted.error?.message || 'No se pudo crear la venta' }, { status: 500 })
    }
    saleId = inserted.data.id

    const collection = await sb
      .from('collections')
      .insert(buildCollection(row, saleId, choice))
      .select('id')
      .single()
    if (collection.error) {
      const { error: rollbackErr } = await sb.from('sales').delete().eq('tenant_id', session.tenantId).eq('id', saleId)
      if (rollbackErr)
        console.error('[sales/drafts/approve] no se pudo deshacer la venta huérfana', saleId, rollbackErr.message)
      const yaEstaba = collection.error.code === '23505'
      return NextResponse.json(
        {
          error: yaEstaba
            ? 'Este pago ya se había registrado (otra petición llegó antes). No se ha duplicado nada.'
            : `No se pudo registrar el cobro (${collection.error.message}), así que se deshizo la venta.`,
        },
        { status: yaEstaba ? 409 : 500 }
      )
    }
    esVentaNueva = true
  }

  // Cierra el borrador. `status` cambia solo si SEGUÍA en 'pending': si dos peticiones llegaron a la
  // vez, la segunda ya se paró arriba en el 409 de `collections`, así que esto no debería fallar, pero
  // el filtro queda para no pisar un estado que otra petición ya resolvió.
  const { error: cierreErr } = await sb
    .from('sale_drafts')
    .update({
      status: 'approved',
      approved_sale_id: saleId,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', draftId)
    .eq('status', 'pending')
  if (cierreErr) console.error('[sales/drafts/approve] el borrador no se pudo cerrar como aprobado:', cierreErr.message)

  const { error: auditErr } = await sb.from('audit_logs').insert({
    tenant_id: session.tenantId,
    entity_type: 'sale',
    entity_id: saleId,
    action: esVentaNueva ? 'create' : 'update',
    actor_user_id: session.userId,
    new_values: {
      origen: 'sale_draft',
      draft_id: draftId,
      payment_reference: draft.payment_reference,
      es_venta_nueva: esVentaNueva,
    },
  })
  if (auditErr) console.error('[sales/drafts/approve] audit_logs no se pudo escribir:', auditErr.message)

  let comisionesGeneradas = 0
  let avisoComisiones: string | undefined
  try {
    const res = await reconcileSaleCommissions(sb, session.tenantId, saleId)
    comisionesGeneradas = res.created
  } catch (e) {
    avisoComisiones = `Venta y cobro registrados, pero las comisiones no se generaron ahora: ${
      e instanceof Error ? e.message : String(e)
    }. Se cuadrarán con la reparación masiva de comisiones.`
  }

  return NextResponse.json({ ok: true, saleId, esVentaNueva, comisionesGeneradas, avisoComisiones })
}
