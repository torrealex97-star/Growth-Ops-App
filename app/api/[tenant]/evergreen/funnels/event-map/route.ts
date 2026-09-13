import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfig } from '@/lib/config'
import {
  EVENT_MAP_KEY,
  mappableStages,
  parseEventMap,
  serializeEventMap,
  validateEventMap,
} from '@/lib/funnels/event-map'

export const runtime = 'nodejs'

// Mapeo de etapas de Funnels ↔ nombres de evento reales de la subcuenta.
//
// `canonical_events.event_name` es texto libre: no hay vocabulario declarado en base. Esta ruta
// muestra los nombres que REALMENTE están llegando, con su volumen, para que el usuario mapee. No
// propone ni adivina ninguno: un diccionario inventado daría números creíbles y falsos.

// Muestra con la que se listan los nombres disponibles. No hay GROUP BY en PostgREST, así que se
// agrupa en memoria sobre una muestra acotada, y la pantalla dice que es una muestra en vez de
// presentarla como el inventario completo.
const SAMPLE_ROWS = 5000
const SAMPLE_DAYS = 90

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error

  const sb = serviceClient()
  try {
    const cfg = await getTenantConfig(session.tenantId, true)
    const map = parseEventMap(cfg[EVENT_MAP_KEY])

    const since = new Date()
    since.setUTCDate(since.getUTCDate() - SAMPLE_DAYS)
    const { data, error } = await sb
      .from('canonical_events')
      .select('event_name,occurred_at')
      .eq('tenant_id', session.tenantId)
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(SAMPLE_ROWS)
    if (error) throw error

    const rows = (data ?? []) as { event_name: string; occurred_at: string }[]
    const byName = new Map<string, { name: string; events: number; lastSeen: string }>()
    for (const row of rows) {
      const current = byName.get(row.event_name)
      if (current) current.events++
      // Las filas vienen ordenadas por fecha descendente, así que la primera vez que se ve un
      // nombre es su aparición más reciente.
      else byName.set(row.event_name, { name: row.event_name, events: 1, lastSeen: row.occurred_at })
    }

    return NextResponse.json({
      canManage: session.isSuperAdmin || session.role === 'admin' || session.role === 'director',
      stages: mappableStages().map((s) => ({ ...s, names: map[s.key] ?? [] })),
      available: [...byName.values()].sort((a, b) => b.events - a.events),
      sample: { rows: rows.length, limit: SAMPLE_ROWS, days: SAMPLE_DAYS, truncated: rows.length >= SAMPLE_ROWS },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron leer los eventos' },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Solo admin o dirección pueden cambiar el mapeo' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as { map?: unknown } | null
  const validated = validateEventMap(body?.map)
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })

  const sb = serviceClient()
  try {
    // `is_secret: false`: es configuración, no una credencial. Cifrarla obligaría a tener
    // CONFIG_ENC_KEY para poder calcular un funnel, y no hay nada que proteger en un nombre de
    // evento propio.
    const { data, error } = await sb
      .from('integration_settings')
      .upsert(
        {
          tenant_id: session.tenantId,
          key: EVENT_MAP_KEY,
          value: serializeEventMap(validated.map),
          is_secret: false,
          label: 'Mapeo de eventos de tracking a etapas de Funnels',
          updated_by: session.userId,
        },
        { onConflict: 'tenant_id,key' }
      )
      .select('key')
    if (error) throw error
    // Sin `.select()` un upsert bloqueado dejaría 0 filas sin error, y la pantalla diría "guardado".
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'El mapeo no se pudo guardar (0 filas afectadas)' }, { status: 500 })
    }
    // La config se cachea 30 s por subcuenta: se fuerza la relectura para que el siguiente cálculo
    // del funnel use ya el mapeo nuevo y el usuario no vea "sin configurar" después de guardar.
    await getTenantConfig(session.tenantId, true)
    return NextResponse.json({ ok: true, stages: Object.keys(validated.map).length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo guardar el mapeo' }, { status: 500 })
  }
}
