import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director']

// POST /api/${tenant}/evergreen/sales/delete
// Borra una venta y TODO lo que cuelga de ella (comisiones, devoluciones, cobros) sin tocar la
// agenda que la originó (sales.appointment_id no se propaga: la cita se queda tal cual, solo deja
// de contar como "comprada" porque hasPurchased() se calcula en vivo desde `sales`).
//
// El borrado directo desde el cliente (supabase.from('sales').delete()) fallaba con violación de
// FK en cuanto la venta tenía cualquier fila colgando (cobros, comisiones, contrato, eventos CSM,
// bajas, u otra venta que la referenciara como upsell/reserva de origen) — ninguna de esas FK
// tiene ON DELETE CASCADE salvo sale_expected_installments/document_verifications/
// payment_follow_ups. Por eso hace falta este endpoint server-side:
//   1) Snapshot del estado ANTES de tocar nada, con TODAS las lecturas verificadas: es la única
//      vía de reconstrucción si el borrado fue un error — un fallo de lectura tragado produciría
//      un snapshot incompleto y un borrado sin forma de deshacer.
//   2) Desenlaza (sale_id = NULL) contratos, eventos CSM y bajas — se conservan, solo dejan de
//      apuntar a la venta borrada. Cada desenlace se verifica (son idempotentes: un reintento
//      los repite sin daño, pero silenciar un fallo dejaba referencias colgantes a una venta
//      que quizá ya no exista al final del request).
//   3) Borra comisiones → devoluciones → cobros con COMPENSACIÓN: si un paso falla, se
//      restauran en orden inverso las filas ya borradas (leídas del snapshot) y se responde 500
//      con el estado real. Sin esto, un fallo a medias dejaba la venta viva SIN su dinero —
//      cobros y comisiones desaparecidos con la venta en pie.
//   4) Borra la venta.
// supabase-js no lanza en fallo: devuelve `{ error }`. En una operación destructiva de dinero,
// tragarlo no es una opción (mismo criterio que #231/#236/#238).

type Snapshot = {
  sale: Record<string, unknown>
  collections: Record<string, unknown>[]
  commissions: Record<string, unknown>[]
  refunds: Record<string, unknown>[]
}

// Restaura el dinero borrado en orden inverso al borrado (cobros → devoluciones → comisiones,
// para respetar la FK commissions.collection_id). Devuelve las tablas que NO se pudieron
// restaurar (array vacío = restauración completa).
async function restaurarDinero(
  sb: SupabaseClient,
  snapshot: Pick<Snapshot, 'collections' | 'commissions' | 'refunds'>
): Promise<string[]> {
  const fallos: string[] = []
  const orden = [
    ['collections', snapshot.collections],
    ['refunds', snapshot.refunds],
    ['commissions', snapshot.commissions],
  ] as const
  for (const [tabla, filas] of orden) {
    if (!filas?.length) continue
    const { error } = await sb.from(tabla).insert(filas)
    if (error) fallos.push(`${tabla}: ${error.message}`)
  }
  return fallos
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { saleId, reason } = await req.json()
    if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const role = t.role || ''
    if (!LEADERSHIP.includes(role)) {
      return NextResponse.json({ error: 'Solo admin/director pueden eliminar ventas' }, { status: 403 })
    }

    // 1) Lectura de la venta con error explícito (maybeSingle: 0 filas = null, no error —
    //    con .single() el "no encontrada" llegaba como error de PostgREST).
    const { data: sale, error: saleReadErr } = await sb
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (saleReadErr)
      return NextResponse.json({ error: `No se pudo leer la venta: ${saleReadErr.message}` }, { status: 500 })
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    // 2) Snapshot ANTES de borrar/desenlazar nada. Las seis lecturas se comprueban: un hueco
    //    aquí es información que NO existirá después para reconstruir la venta.
    const [
      { data: collections, error: collSnapErr },
      { data: commissions, error: commSnapErr },
      { data: refunds, error: refSnapErr },
      { data: contracts, error: contrSnapErr },
      { data: csmEvents, error: csmSnapErr },
      { data: drops, error: dropsSnapErr },
    ] = await Promise.all([
      sb.from('collections').select('*').eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('commissions').select('*').eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('refunds').select('*').eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('contracts').select('*').eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('csm_events').select('*').eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('drops').select('*').eq('sale_id', saleId).eq('tenant_id', t.tenantId),
    ])
    const erroresSnapshot = (
      [
        ['cobros', collSnapErr],
        ['comisiones', commSnapErr],
        ['devoluciones', refSnapErr],
        ['contratos', contrSnapErr],
        ['eventos CSM', csmSnapErr],
        ['bajas', dropsSnapErr],
      ] as const
    )
      .filter(([, e]) => e)
      .map(([nombre, e]) => `${nombre}: ${e!.message}`)
    if (erroresSnapshot.length) {
      return NextResponse.json(
        { error: `No se pudo preparar el snapshot de auditoría (${erroresSnapshot.join('; ')})` },
        { status: 500 }
      )
    }

    const { error: logErr } = await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'delete',
      old_values: { sale, collections, commissions, refunds, contracts, csmEvents, drops },
      new_values: { reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null },
    })
    if (logErr)
      return NextResponse.json({ error: `No se pudo registrar el borrado: ${logErr.message}` }, { status: 500 })

    // 3) Desenlaza (no borra) filas que solo REFERENCIAN la venta: se conservan sin el vínculo.
    //    Verificado una a una: idempotentes, pero silenciar un fallo dejaba referencias colgantes.
    const desenlaces = await Promise.all([
      sb.from('contracts').update({ sale_id: null }).eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('csm_events').update({ sale_id: null }).eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('drops').update({ sale_id: null }).eq('sale_id', saleId).eq('tenant_id', t.tenantId),
      sb.from('sales').update({ origin_sale_id: null }).eq('origin_sale_id', saleId).eq('tenant_id', t.tenantId),
      sb
        .from('sales')
        .update({ converted_from_reservation_id: null })
        .eq('converted_from_reservation_id', saleId)
        .eq('tenant_id', t.tenantId),
    ])
    const nombresDesenlace = [
      'contratos',
      'eventos CSM',
      'bajas',
      'ventas con esta como origen',
      'ventas convertidas de esta reserva',
    ] as const
    const fallosDesenlace = desenlaces
      .map((r, i) => (r.error ? `${nombresDesenlace[i]}: ${r.error.message}` : null))
      .filter((x): x is string => !!x)
    if (fallosDesenlace.length) {
      return NextResponse.json(
        { error: `No se pudieron desenlazar los registros que referencian la venta (${fallosDesenlace.join('; ')})` },
        { status: 500 }
      )
    }

    // 4) Orden que respeta las FK: comisiones → devoluciones → cobros → venta, cada paso
    //    verificado y con compensación del dinero ya borrado si el siguiente falla. La
    //    restauración inserta las filas COMPLETAS del snapshot (el delete no devuelve las filas;
    //    un insert de solo ids violaría las NOT NULL). Los delete son por filtro: 0 filas
    //    afectadas significa "no había", no un fallo silencioso.
    //    (sale_expected_installments/document_verifications/payment_follow_ups cascadean solas)
    const { error: commErr } = await sb.from('commissions').delete().eq('sale_id', saleId).eq('tenant_id', t.tenantId)
    if (commErr)
      return NextResponse.json({ error: `No se pudieron borrar las comisiones: ${commErr.message}` }, { status: 500 })

    const { error: refErr } = await sb.from('refunds').delete().eq('sale_id', saleId).eq('tenant_id', t.tenantId)
    if (refErr) {
      const sinRestaurar = await restaurarDinero(sb, {
        collections: [],
        commissions: commissions ?? [],
        refunds: [],
      })
      if (sinRestaurar.length)
        return NextResponse.json(
          {
            error:
              `Fallo borrando devoluciones (${refErr.message}) y NO se pudieron restaurar las comisiones ya borradas ` +
              `(${sinRestaurar.join('; ')}). La venta sigue intacta y el snapshot completo está en audit_logs ` +
              `(entity_id=${saleId}, action=delete): NO repetir el borrado y NO crear filas a mano; recuperar de ahí.`,
          },
          { status: 500 }
        )
      return NextResponse.json(
        { error: `No se pudieron borrar las devoluciones (${refErr.message}); comisiones restauradas, nada borrado` },
        { status: 500 }
      )
    }

    const { error: collErr } = await sb.from('collections').delete().eq('sale_id', saleId).eq('tenant_id', t.tenantId)
    if (collErr) {
      const sinRestaurar = await restaurarDinero(sb, {
        collections: [],
        commissions: commissions ?? [],
        refunds: refunds ?? [],
      })
      const estado = sinRestaurar.length
        ? `NO se pudieron restaurar (${sinRestaurar.join('; ')}); el snapshot completo está en audit_logs ` +
          `(entity_id=${saleId}, action=delete): NO repetir el borrado y NO crear filas a mano; recuperar de ahí.`
        : 'dinero restaurado por completo, no se ha borrado nada.'
      return NextResponse.json(
        { error: `No se pudieron borrar los cobros (${collErr.message}); ${estado}` },
        { status: 500 }
      )
    }

    const { error: saleErr } = await sb.from('sales').delete().eq('id', saleId).eq('tenant_id', t.tenantId)
    if (saleErr) {
      const sinRestaurar = await restaurarDinero(sb, {
        collections: collections ?? [],
        commissions: commissions ?? [],
        refunds: refunds ?? [],
      })
      const estado = sinRestaurar.length
        ? `NO se pudieron restaurar (${sinRestaurar.join('; ')}); el snapshot completo está en audit_logs ` +
          `(entity_id=${saleId}, action=delete): NO repetir el borrado y NO crear filas a mano; recuperar de ahí.`
        : 'dinero restaurado por completo (comisiones, devoluciones y cobros), la venta sigue intacta.'
      return NextResponse.json({ error: `No se pudo borrar la venta (${saleErr.message}); ${estado}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
