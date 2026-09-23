import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { NORMALIZADORES, reprocesar } from '@/lib/eventos/replay'

export const runtime = 'nodejs'
export const maxDuration = 60

// F1 — REPROCESAR EVENTOS DE UN RANGO.
//
// POST { source, desde, hasta, simulacion?, limite?, cursor? }
//
// SIMULACIÓN POR DEFECTO. Sin `simulacion: false` explícito, esto NO escribe: cuenta qué cambiaría y
// lo explica. El plan lo pide así ("dry-run y resumen antes de afectar proyecciones") y es la
// diferencia entre reparar un día y estropear dos.
//
// Acceso: admin o director de la subcuenta, o `Authorization: Bearer <CRON_SECRET>` para poder
// lanzarlo desde un workflow sin sesión de navegador.

const ISO_CORTA = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/

function servicio() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const cabecera = req.headers.get('authorization')
  const viaCron = !!process.env.CRON_SECRET && cabecera === `Bearer ${process.env.CRON_SECRET}`

  const sb = servicio()
  let tenantId: string | null = null

  if (viaCron) {
    const { data } = await sb.from('tenants').select('id').eq('slug', tenant).eq('status', 'active').maybeSingle()
    tenantId = data?.id ?? null
    if (!tenantId) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
  } else {
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error
    // Reprocesar reescribe hechos de los que salen las métricas: no es una lectura.
    if (!auth.isSuperAdmin && auth.role !== 'admin' && auth.role !== 'director') {
      return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
    }
    tenantId = auth.tenantId
  }

  const body = (await req.json().catch(() => ({}))) as {
    source?: string
    desde?: string
    hasta?: string
    simulacion?: boolean
    limite?: number
    cursor?: { recibidoEn: string; id: string } | null
  }

  const source = String(body.source ?? '').trim()
  if (!source) {
    return NextResponse.json(
      { error: 'Falta "source"', fuentesConNormalizador: Object.keys(NORMALIZADORES) },
      { status: 400 }
    )
  }
  const desde = String(body.desde ?? '')
  const hasta = String(body.hasta ?? '')
  if (!ISO_CORTA.test(desde) || !ISO_CORTA.test(hasta)) {
    return NextResponse.json({ error: 'Las fechas van en formato YYYY-MM-DD (o ISO completo)' }, { status: 400 })
  }
  if (desde > hasta) {
    return NextResponse.json({ error: 'La fecha de inicio es posterior a la de fin' }, { status: 400 })
  }

  // La simulación es lo que pasa salvo que alguien diga lo contrario a propósito.
  const simulacion = body.simulacion !== false

  try {
    const resumen = await reprocesar(sb, {
      tenantId,
      source,
      desde,
      hasta,
      simulacion,
      limite: body.limite,
      cursor: body.cursor ?? null,
      // Margen para responder: morir a los 60 s sin devolver el cursor obligaría a empezar de cero.
      deadline: Date.now() + 45_000,
    })

    return NextResponse.json({
      ok: true,
      ...resumen,
      // Se dice explícitamente si queda trabajo, en vez de dejar que quien llama deduzca del cursor.
      quedaTrabajo: resumen.cursor !== null,
      siguiente: resumen.cursor ? { ...body, simulacion, cursor: resumen.cursor } : null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
