import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'
import { newPublicKey } from '@/lib/tracking/ingest'

export const runtime = 'nodejs'

// Escrituras en tracking_sites: la migración define RLS restrictiva y SIN policy de INSERT/UPDATE a
// propósito — los sites se gestionan server-side tras autorizar por rol (requireTenant +
// administraTenant). Lecturas: cliente autenticado (policy tracking_sites_read). El helper devuelve
// null si falta la clave de servicio (local sin secretos) para dar un 500 claro en vez de un crash
// del constructor.
function serviceSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

// GET: sites de la subcuenta + datos REALES de salud (eventos 24h, último recibido, errores).
// Nada de "Connected" fingido: si no hay eventos, el estado lo dice.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = await createClient()
    const { data: sites, error } = await sb
      .from('tracking_sites')
      .select('id, slug, name, public_key, allowed_origins, allow_localhost, tracking_enabled, created_at')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const ids = (sites ?? []).map((s) => s.id)

    // Conteos por site en una sola query (agrupado en cliente: son pocos sites).
    const { data: recent } = await sb
      .from('raw_events')
      .select('site_id, processing_status, rejection_reason, received_at')
      .eq('tenant_id', t.tenantId)
      .in('site_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      .gte('received_at', since24h)

    const stats = new Map<string, { events24h: number; errors24h: number; lastEventAt: string | null }>()
    for (const r of recent ?? []) {
      if (!r.site_id) continue
      const cur = stats.get(r.site_id) ?? { events24h: 0, errors24h: 0, lastEventAt: null }
      cur.events24h += 1
      if (r.processing_status === 'rejected') cur.errors24h += 1
      if (!cur.lastEventAt || r.received_at > cur.lastEventAt) cur.lastEventAt = r.received_at
      stats.set(r.site_id, cur)
    }

    return NextResponse.json({
      sites: (sites ?? []).map((s) => ({
        ...s,
        events24h: stats.get(s.id)?.events24h ?? 0,
        errors24h: stats.get(s.id)?.errors24h ?? 0,
        lastEventAt: stats.get(s.id)?.lastEventAt ?? null,
      })),
    })
  } catch (err) {
    console.error('[api/tracking/sites GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// POST: crear site (slug, nombre, orígenes autorizados). La clave pública la genera el servidor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!t.administraTenant) {
      return NextResponse.json({ error: 'Solo dirección puede gestionar sitios de tracking' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      slug?: string
      name?: string
      allowed_origins?: string[]
      allow_localhost?: boolean
    }
    const slug = (body.slug ?? '').trim().toLowerCase()
    const name = (body.name ?? '').trim()
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      return NextResponse.json({ error: 'Slug inválido (minúsculas, números y guiones)' }, { status: 400 })
    }
    if (!name) return NextResponse.json({ error: 'Falta el nombre' }, { status: 400 })
    const origins = (body.allowed_origins ?? [])
      .map((o) => String(o).trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .slice(0, 20)

    const sb = serviceSb()
    if (!sb)
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno' }, { status: 500 })
    const { data, error } = await sb
      .from('tracking_sites')
      .insert({
        tenant_id: t.tenantId,
        slug,
        name,
        public_key: newPublicKey(),
        allowed_origins: origins,
        allow_localhost: !!body.allow_localhost,
        // Arranca APAGADO (migración): activar es una decisión consciente en el toggle.
        tracking_enabled: false,
      })
      .select('id, slug, name, public_key, tracking_enabled')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un sitio con ese slug' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ site: data }, { status: 201 })
  } catch (err) {
    console.error('[api/tracking/sites POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// PATCH: toggle de tracking_enabled y edición de orígenes.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!t.administraTenant) {
      return NextResponse.json({ error: 'Solo dirección puede gestionar sitios de tracking' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      id?: string
      tracking_enabled?: boolean
      allowed_origins?: string[]
      allow_localhost?: boolean
    }
    if (!body.id) return NextResponse.json({ error: 'Falta el id del sitio' }, { status: 400 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.tracking_enabled === 'boolean') patch.tracking_enabled = body.tracking_enabled
    if (Array.isArray(body.allowed_origins)) {
      patch.allowed_origins = body.allowed_origins
        .map((o) => String(o).trim().replace(/\/+$/, ''))
        .filter(Boolean)
        .slice(0, 20)
    }
    if (typeof body.allow_localhost === 'boolean') patch.allow_localhost = body.allow_localhost

    const sb = serviceSb()
    if (!sb)
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno' }, { status: 500 })
    const { error } = await sb.from('tracking_sites').update(patch).eq('id', body.id).eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/tracking/sites PATCH]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
