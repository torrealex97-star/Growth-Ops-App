import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { getTenantConfig } from '@/lib/config'
import { computeFunnel } from '@/lib/funnels/compute'
import { FUNNEL_FAMILIES, type FunnelFamily } from '@/lib/funnels/definitions'
import { EVENT_MAP_KEY, parseEventMap } from '@/lib/funnels/event-map'
import { loadFunnelCounts } from '@/lib/funnels/queries'

export const runtime = 'nodejs'

// GET /api/[tenant]/evergreen/funnels?family=vsl&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// El tenant sale SIEMPRE de la URL y lo valida requireTenant: nunca del body ni de un parámetro de
// consulta, para que no se pueda pedir el funnel de otra subcuenta cambiando un id.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  // Pertenecer a la subcuenta NO basta: esta ruta cuenta con service-role para que el funnel no
  // cambie según quién mire (ver más abajo), así que RLS no la protege. Se exige el mismo acceso
  // que a la pantalla /funnels (auditoría F02).
  const session = await requirePantalla(tenant, '/funnels')
  if ('error' in session) return session.error

  const url = new URL(req.url)
  const familyParam = url.searchParams.get('family') || 'vsl'
  if (!FUNNEL_FAMILIES.includes(familyParam as FunnelFamily)) {
    return NextResponse.json({ error: `Familia de funnel desconocida: ${familyParam}` }, { status: 400 })
  }
  const family = familyParam as FunnelFamily

  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const from = url.searchParams.get('from') || defaultFrom(to)
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ error: 'Las fechas deben ir en formato YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'La fecha de inicio es posterior a la de fin' }, { status: 400 })
  }

  // Service role, pero con el tenantId de la sesión ya validada y estampado en cada consulta dentro
  // de loadFunnelCounts. Se usa para poder contar con `head: true` sin que RLS limite el recuento a
  // las filas visibles del rol, que daría un funnel distinto según quién mire la misma pantalla.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // El mapeo de eventos se lee de la config de ESTA subcuenta (getTenantConfig, no el que hace
    // fallback a process.env): una variable de entorno global mapearía los eventos de todas las
    // subcuentas a la vez, que es justo lo que no debe pasar.
    const cfg = await getTenantConfig(session.tenantId)
    const eventMap = parseEventMap(cfg[EVENT_MAP_KEY])

    const { counts, inversion } = await loadFunnelCounts(
      sb,
      session.tenantId,
      family,
      // `to` se extiende al final del día: appointment_datetime es timestamptz, y comparar contra
      // la fecha desnuda dejaría fuera todo lo del último día salvo la medianoche exacta.
      { from, to: `${to}T23:59:59.999Z` },
      eventMap
    )
    return NextResponse.json({ ...computeFunnel({ family, counts, inversion }), range: { from, to } })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo calcular el funnel' },
      { status: 500 }
    )
  }
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}

// Por defecto, los 30 días anteriores a `to` (incluido), que es la ventana con la que se mira un
// funnel de captación.
function defaultFrom(to: string): string {
  const d = new Date(`${to}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 29)
  return d.toISOString().slice(0, 10)
}
