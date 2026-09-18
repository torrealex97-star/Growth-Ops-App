import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { accessTokenFromRefresh, listProperties, runReport, GA4_PAGE_SIZE, type Ga4Row } from '@/lib/google/ga4'
import { googleCredentials } from '@/lib/google/oauth'

export const runtime = 'nodejs'
export const maxDuration = 60

// Sync de GA4 hacia ga4_daily. El grano y la idempotencia los garantiza el índice único de la tabla,
// así que volver a pedir un rango ya importado ACTUALIZA en vez de duplicar — que es necesario,
// porque GA4 reprocesa sus propios datos durante unas 48 horas.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type Connection = {
  id: string
  refresh_token: string
  ga4_property_id: string | null
  status: string
  last_sync_at: string | null
  google_email: string | null
}

async function loadConnection(sb: SupabaseClient, tenantId: string): Promise<Connection | null> {
  const { data } = await sb
    .from('google_oauth_connections')
    .select('id,refresh_token,ga4_property_id,status,last_sync_at,google_email')
    .eq('tenant_id', tenantId)
    .eq('provider', 'ga4')
    .maybeSingle()
  return (data as Connection) ?? null
}

async function requireManage(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return { ok: false as const, res: session.error }
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return {
      ok: false as const,
      res: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }),
    }
  }
  return { ok: true as const, session }
}

// GET — estado de la conexión y, con ?propiedades=1, la lista de propiedades para elegir.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireManage(tenant)
    if (!auth.ok) return auth.res
    const sb = serviceClient()
    const conn = await loadConnection(sb, auth.session.tenantId)

    if (!conn) return NextResponse.json({ conectada: false })

    const base = {
      conectada: true,
      estado: conn.status,
      cuenta: conn.google_email,
      propiedad: conn.ga4_property_id,
      ultimo_sync: conn.last_sync_at,
    }
    if (new URL(req.url).searchParams.get('propiedades') !== '1') return NextResponse.json(base)

    const creds = await googleCredentials(auth.session.tenantId)
    if (!creds) return NextResponse.json({ ...base, error: 'Faltan las credenciales de Google' }, { status: 400 })
    const token = await accessTokenFromRefresh(conn.refresh_token, creds)
    if ('error' in token) {
      await marcarError(sb, conn.id, token.error, token.revoked)
      return NextResponse.json({ ...base, error: token.error, revocada: token.revoked }, { status: 400 })
    }
    const props = await listProperties(token.token)
    if ('error' in props) return NextResponse.json({ ...base, error: props.error }, { status: 400 })
    return NextResponse.json({ ...base, propiedades: props.items })
  } catch (err) {
    console.error('[api/ga4 GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

async function marcarError(sb: SupabaseClient, id: string, error: string, revoked: boolean) {
  await sb
    .from('google_oauth_connections')
    .update({ status: revoked ? 'revocada' : 'error', last_error: error })
    .eq('id', id)
}

// POST — elige propiedad y/o sincroniza.
//   { propiedad: "properties/123" }              → guarda la propiedad
//   { from, to, dryRun? }                        → sincroniza ese rango
// Sin from/to sincroniza los últimos 7 días, que cubre la ventana de reproceso de GA4.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireManage(tenant)
    if (!auth.ok) return auth.res
    const { session } = auth
    const sb = serviceClient()

    const body = (await req.json().catch(() => ({}))) as {
      propiedad?: string
      from?: string
      to?: string
      dryRun?: boolean
    }

    const conn = await loadConnection(sb, session.tenantId)
    if (!conn) {
      return NextResponse.json({ error: 'GA4 no está conectado en esta subcuenta' }, { status: 400 })
    }

    if (body.propiedad) {
      const { data, error } = await sb
        .from('google_oauth_connections')
        .update({ ga4_property_id: body.propiedad, status: 'conectada', last_error: null })
        .eq('id', conn.id)
        .eq('tenant_id', session.tenantId)
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) {
        return NextResponse.json({ error: 'No se pudo guardar la propiedad' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, propiedad: body.propiedad })
    }

    if (!conn.ga4_property_id) {
      return NextResponse.json({ error: 'Elige primero una propiedad de GA4' }, { status: 400 })
    }

    const to = body.to || isoDay(0)
    const from = body.from || isoDay(6)
    if (!isIsoDate(from) || !isIsoDate(to)) {
      return NextResponse.json({ error: 'Las fechas deben ir en formato YYYY-MM-DD' }, { status: 400 })
    }
    if (from > to) return NextResponse.json({ error: 'La fecha de inicio es posterior a la de fin' }, { status: 400 })

    const creds = await googleCredentials(session.tenantId)
    if (!creds) return NextResponse.json({ error: 'Faltan las credenciales de Google' }, { status: 400 })
    const token = await accessTokenFromRefresh(conn.refresh_token, creds)
    if ('error' in token) {
      await marcarError(sb, conn.id, token.error, token.revoked)
      return NextResponse.json(
        {
          error: token.revoked
            ? 'Google ha revocado el acceso. Hay que volver a conectar la cuenta.'
            : `No se pudo renovar el acceso: ${token.error}`,
        },
        { status: 400 }
      )
    }

    const dryRun = body.dryRun === true
    let offset = 0
    let leidas = 0
    let escritas = 0
    let paginas = 0
    const muestra: Ga4Row[] = []

    // Paginación por offset hasta agotar el rango. El tope de páginas evita un bucle infinito si la
    // API devolviera un total incoherente con lo que entrega.
    while (paginas < 20) {
      const page = await runReport({
        accessToken: token.token,
        propertyId: conn.ga4_property_id,
        from,
        to,
        offset,
      })
      if ('error' in page) {
        await marcarError(sb, conn.id, page.error, false)
        return NextResponse.json({ error: page.error, leidas, escritas }, { status: 400 })
      }
      leidas += page.rows.length
      if (muestra.length < 10) muestra.push(...page.rows.slice(0, 10 - muestra.length))

      if (!dryRun && page.rows.length > 0) {
        const filas = page.rows.map((r) => ({ tenant_id: session.tenantId, ...r, synced_at: new Date().toISOString() }))
        // .select() para contar lo que se escribió DE VERDAD, no lo que se envió: si RLS o un CHECK
        // rechazaran filas, contarlas como escritas daría un informe de sync falso.
        const { data, error } = await sb
          .from('ga4_daily')
          .upsert(filas, { onConflict: 'tenant_id,date,source,medium,campaign,landing_page,device' })
          .select('id')
        if (error) {
          await marcarError(sb, conn.id, error.message, false)
          return NextResponse.json({ error: error.message, leidas, escritas }, { status: 500 })
        }
        escritas += data?.length ?? 0
      }

      paginas++
      if (page.rows.length < GA4_PAGE_SIZE) break
      offset += page.rows.length
    }

    if (!dryRun) {
      await sb
        .from('google_oauth_connections')
        .update({ last_sync_at: new Date().toISOString(), status: 'conectada', last_error: null })
        .eq('id', conn.id)
    }

    return NextResponse.json({ ok: true, dryRun, rango: { from, to }, paginas, leidas, escritas, muestra })
  } catch (err) {
    console.error('[api/ga4 POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}
function isoDay(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
