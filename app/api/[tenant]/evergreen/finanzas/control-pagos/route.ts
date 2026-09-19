import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { controlPorPersona, type PagoEspejo, type ClienteStripe } from '@/lib/payments/control-personas'

export const runtime = 'nodejs'

// CONTROL DE PAGOS POR PERSONA. El dinero real vive en stripe_payments (espejo del cron); la
// identidad, en stripe_customers (customer→contact) y en el cruce con collections por
// payment_reference. La capa semántica (lib/payments/control-personas) reconstruye reservas,
// planes, suscripciones e impagos POR PERSONA — el kanban por venta sigue en la pantalla.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  try {
    const [espejoRes, clientesRes, contactosRes, ventasRes, cobrosRes] = await Promise.all([
      sb
        .from('stripe_payments')
        .select('payment_id,charge_id,customer_id,amount,refunded_amount,status,paid_at')
        .eq('tenant_id', auth.tenantId)
        .order('paid_at', { ascending: true })
        .limit(2000),
      sb
        .from('stripe_customers')
        .select('stripe_customer_id,contact_id,email,name,status')
        .eq('tenant_id', auth.tenantId)
        .limit(1000),
      sb.from('contacts').select('id,full_name,email').eq('tenant_id', auth.tenantId).limit(5000),
      sb
        .from('sales')
        .select('id,contact_id,gross_amount,status,sale_date,product_id')
        .eq('tenant_id', auth.tenantId)
        .limit(2000),
      sb
        .from('collections')
        .select('id,sale_id,gross_amount,status,payment_reference,collected_at')
        .eq('tenant_id', auth.tenantId)
        .limit(3000),
    ])
    if (espejoRes.error) return NextResponse.json({ error: espejoRes.error.message }, { status: 500 })

    const espejo = (espejoRes.data ?? []) as Array<Record<string, unknown>>
    const refsInternas = new Set(
      ((cobrosRes.data ?? []) as Array<{ payment_reference: string | null }>)
        .map((c) => (c.payment_reference || '').trim())
        .filter((r) => r.startsWith('pi_') || r.startsWith('ch_'))
    )
    const pagos: PagoEspejo[] = espejo.map((p) => ({
      payment_id: String(p.payment_id),
      charge_id: (p.charge_id as string) ?? null,
      customer_id: (p.customer_id as string) ?? null,
      amount: Number(p.amount),
      refunded_amount: Number(p.refunded_amount ?? 0),
      status: String(p.status),
      paid_at: (p.paid_at as string) ?? null,
      ref_interna: refsInternas.has(String(p.payment_id))
        ? String(p.payment_id)
        : refsInternas.has(String(p.charge_id ?? ''))
          ? String(p.charge_id)
          : null,
    }))

    // SCOPE DE COLABORADOR: ver solo las personas de SUS contactos atribuidos (§16).
    const { resolverScopeColaborador, contactIdsDeScope } = await import('@/lib/collaborators/scope')
    const scope = await resolverScopeColaborador(sb, auth.userId, auth.tenantId)
    const contactIds = await contactIdsDeScope(sb, auth.tenantId, scope)

    // Producto por venta (precio/duración) para inferir planes y suscripciones.
    const ventas = (ventasRes.data ?? []) as Array<{
      id: string
      product_id: string | null
      gross_amount: number
      [k: string]: unknown
    }>
    const productos = await sb.from('products').select('id,name,duration_months').eq('tenant_id', auth.tenantId)
    const productoPorId = new Map(
      ((productos.data ?? []) as Array<{ id: string; name: string; duration_months: number | null }>).map(
        (p) => [p.id, { name: p.name, duration_months: p.duration_months }] as const
      )
    )

    let ventasFiltradas = ventas
    if (contactIds) {
      const permitidos = new Set(contactIds)
      ventasFiltradas = ventas.filter((v) => permitidos.has(String(v.contact_id)))
      // la identidad del pago (contact_id de stripe_customers) también se acota al scope
    }

    const personas = controlPorPersona(
      pagos,
      (clientesRes.data ?? []) as unknown as ClienteStripe[],
      (contactosRes.data ?? []) as Array<{ id: string; full_name: string; email: string | null }>,
      ventasFiltradas.map((v) => ({
        id: v.id,
        contact_id: (v.contact_id as string) ?? null,
        gross_amount: Number(v.gross_amount),
        status: String(v.status),
        sale_date: (v.sale_date as string) ?? null,
      })),
      (cobrosRes.data ?? []) as Array<{
        id: string
        sale_id: string
        gross_amount: number
        status: string
        payment_reference: string | null
        collected_at: string | null
      }>,
      (productos.data ?? []) as Array<{ id: string; name: string; duration_months: number | null }>,
      new Map(
        ventas
          .filter((v) => v.product_id && productoPorId.get(String(v.product_id)))
          .map((v) => [
            v.id,
            {
              name: productoPorId.get(String(v.product_id))!.name,
              duration_months: productoPorId.get(String(v.product_id))!.duration_months,
            },
          ])
      )
    )

    const personasFinales = contactIds
      ? personas.filter((p) => p.contact_id && new Set(contactIds).has(p.contact_id))
      : personas

    return NextResponse.json({
      personas: personasFinales,
      resumen: {
        totalPersonas: personasFinales.length,
        clientes: personasFinales.filter((p) =>
          ['cliente_activo', 'cliente_completado', 'suscripcion', 'plan_a_plazos', 'reserva_pendiente'].includes(
            p.estadoCliente
          )
        ).length,
        suscripciones: personasFinales.filter((p) => p.estadoCliente === 'suscripcion').length,
        conImpago: personasFinales.filter((p) => p.impagos > 0).length,
        reservasPendientes: personasFinales.filter((p) => p.estadoCliente === 'reserva_pendiente').length,
        reservasDevueltas: personasFinales.filter((p) => p.estadoCliente === 'reserva_devuelta').length,
        netoTotal: personasFinales.reduce((s, p) => s + p.netoPagado, 0),
      },
    })
  } catch (e) {
    console.error('[api/finanzas/control-pagos]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
