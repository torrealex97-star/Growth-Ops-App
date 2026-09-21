import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { getApifyConfig, isApifyEnabled } from '@/lib/social/apify'
import { agregarOrganicoOficial, type FilaPostOficial, type FilaPerfilOficial } from '@/lib/social/organic'

export const runtime = 'nodejs'
export const maxDuration = 60

// MÉTRICAS ORGÁNICAS DE LAS CUENTAS PROPIAS — SOLO APIs OFICIALES.
//
// Regla del brief (21-sep): lo que se puede ver con la API oficial de cada plataforma NUNCA
// pasa por Apify (scrapear la cuenta propia es exactamente el patrón de bot no autorizado que
// arriesga un baneo). Aquí servimos lo que lib/instagram/sync.ts ya trajo por Graph API a
// ig_media / ig_account_daily. El disparador de la sync es el botón/cron oficial:
// POST /api/${tenant}/evergreen/instagram/sync — este endpoint NO llama a Apify NI a Meta.
// Apify queda reservado a la investigación de TERCEROS (evergreen/social/research).

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function requireRole(tenantSlug: string) {
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return { error: t.error }
  const role = t.role
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return t
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireRole(tenant)
  if ('error' in auth) return auth.error
  const sb = svc()

  const url = new URL(req.url)
  const desde = url.searchParams.get('desde') || undefined
  const hasta = url.searchParams.get('hasta') || undefined
  const rango: { desde?: string; hasta?: string } = {}
  if (desde) rango.desde = desde
  if (hasta) rango.hasta = hasta

  // Datos OFICIALES ya en BD (poblados por la sync de Graph API). read-only.
  const [perfilRes, mediasRes, snapsRes] = await Promise.all([
    sb
      .from('ig_account_daily')
      .select('snapshot_date, followers_count, media_count, reach, synced_at')
      .eq('tenant_id', auth.tenantId)
      .order('snapshot_date', { ascending: false })
      .limit(1),
    sb
      .from('ig_media')
      .select(
        'media_type, published_at, likes, comments, views, reach, shares, saved, engagement_rate, permalink, synced_at'
      )
      .eq('tenant_id', auth.tenantId)
      .order('published_at', { ascending: false })
      .limit(200),
    sb
      .from('ig_account_daily')
      .select('snapshot_date, followers_count, reach, profile_views, new_follows, unfollows')
      .eq('tenant_id', auth.tenantId)
      .order('snapshot_date', { ascending: false })
      .limit(90),
  ])

  const perfil: FilaPerfilOficial | null = perfilRes.data?.[0]
    ? {
        platform: 'instagram',
        followers_count: perfilRes.data[0].followers_count,
        posts_count: perfilRes.data[0].media_count,
        collected_at: perfilRes.data[0].synced_at,
        username: undefined, // el handle lo sirve el panel desde la config de Integraciones
      }
    : null

  const instagram = agregarOrganicoOficial(
    perfil,
    (mediasRes.data || []) as FilaPostOficial[],
    snapsRes.data || [],
    rango
  )

  // Estado de las dos fuentes, para que la UI sea honesta (§25):
  // - oficial: ¿hay credenciales de Instagram configuradas? (la sync es el camino de datos)
  // - apify: SOLO para terceros; se informa pero no alimenta este panel.
  const cfgEnv = await getTenantConfigWithFallback(auth.tenantId, true)
  const oficialDisponible = !!(cfgEnv.INSTAGRAM_ACCESS_TOKEN || cfgEnv.META_ACCESS_TOKEN)
  const apify = getApifyConfig(cfgEnv)

  return NextResponse.json({
    source: 'official',
    apis: {
      instagram: { disponible: oficialDisponible, disparador: 'POST /api/${tenant}/evergreen/instagram/sync' },
      apify: { configurado: !!apify, uso: 'solo investigación de terceros (evergreen/social/research)' },
    },
    ultimaSync: instagram?.lastSyncedAt ?? null,
    plataformas: instagram ? [instagram] : [],
    // Nota para la UI: TikTok/YouTube sin sync oficial aún → sin tarjeta (no se inventan datos).
  })
}

// POST → disparar la SYNC OFICIAL de Instagram (Graph API). Nunca lanza investigaciones Apify:
// si alguien intenta pasar handles, se rechaza con una explicación accionable.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireRole(tenant)
  if ('error' in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> | null
  if (body && Object.keys(body).length > 0) {
    return NextResponse.json(
      {
        error:
          'Las métricas de las cuentas PROPIAS se traen por la API oficial (Instagram Graph), no por scraping: no se aceptan handles. Apify queda reservado a terceros.',
        code: 'propietario_no_va_por_apify',
      },
      { status: 400 }
    )
  }

  // Reenvía a la sync oficial conservando la sesión (cookies) del usuario.
  const origin = new URL(req.url).origin
  const r = await fetch(`${origin}/api/${tenant}/evergreen/instagram/sync`, {
    method: 'POST',
    headers: { cookie: req.headers.get('cookie') || '' },
  })
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return NextResponse.json(j, { status: r.status })
}
