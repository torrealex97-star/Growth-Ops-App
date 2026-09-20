import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { actorFor, createResearchJob, getApifyConfig, isApifyEnabled } from '@/lib/social/apify'
import { agregarOrganico, type FilaPerfil, type FilaPost } from '@/lib/social/organic'
import { RESEARCH_LIMITS, type SocialPlatform } from '@/lib/social/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// CAPA ORGÁNICA DEL DASHBOARD (prototipo) — métricas públicas de las cuentas del negocio
// (Instagram/TikTok) traídas por Apify. NUNCA operamos sobre la cuenta conectada: al Actor solo
// van handles públicos (§17), la cuenta de Meta no participa en estas consultas (§1/§16).
// GET  → KPIs agregados de social_profiles/social_posts (§16: el dashboard NO llama a Apify).
// POST → sync: crea jobs asíncronos (§7); el resultado entra por webhook y este GET lo refleja.

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']
const PLATAFORMAS: SocialPlatform[] = ['instagram', 'tiktok']

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

/** Handle por plataforma: body → último username recolectado (se recuerda del sync anterior). */
async function resolverHandles(
  sb: ReturnType<typeof svc>,
  tenantId: string,
  body: { instagram?: string; tiktok?: string }
): Promise<{ instagram?: string; tiktok?: string; faltan: string[] }> {
  const { data: perfiles } = await sb
    .from('social_profiles')
    .select('platform, username, collected_at')
    .eq('tenant_id', tenantId)
    .in('platform', PLATAFORMAS)
    .order('collected_at', { ascending: false })
  const recordado = new Map<SocialPlatform, string>()
  for (const p of perfiles || []) {
    const plat = p.platform as SocialPlatform
    if (!recordado.has(plat) && p.username) recordado.set(plat, String(p.username).replace(/^@/, ''))
  }
  const limpiar = (v?: string) => v?.trim().replace(/^@/, '') || undefined
  const instagram = limpiar(body.instagram) || recordado.get('instagram')
  const tiktok = limpiar(body.tiktok) || recordado.get('tiktok')
  const faltan: string[] = []
  if (!instagram) faltan.push('instagram')
  if (!tiktok) faltan.push('tiktok')
  return { instagram, tiktok, faltan }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireRole(tenant)
  if ('error' in auth) return auth.error
  const sb = svc()

  const cfgEnv = await getTenantConfigWithFallback(auth.tenantId, true)
  const cfg = getApifyConfig(cfgEnv)

  const url = new URL(req.url)
  const desde = url.searchParams.get('desde') || undefined
  const hasta = url.searchParams.get('hasta') || undefined
  const rango: { desde?: string; hasta?: string } = {}
  if (desde) rango.desde = desde
  if (hasta) rango.hasta = hasta

  const [{ data: perfiles }, { data: posts }, { data: jobs }] = await Promise.all([
    sb
      .from('social_profiles')
      .select('platform, username, followers_count, posts_count, collected_at')
      .eq('tenant_id', auth.tenantId)
      .in('platform', PLATAFORMAS)
      .order('collected_at', { ascending: false }),
    sb
      .from('social_posts')
      .select(
        'platform, username, content_type, published_at, views_count, likes_count, comments_count, shares_count, collected_at, post_url'
      )
      .eq('tenant_id', auth.tenantId)
      .in('platform', PLATAFORMAS)
      .order('published_at', { ascending: false })
      .limit(500),
    sb
      .from('social_research_jobs')
      .select('id, platform, job_type, status, created_at, completed_at, error_message')
      .eq('tenant_id', auth.tenantId)
      .in('platform', PLATAFORMAS)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const plataformas = agregarOrganico((perfiles || []) as FilaPerfil[], (posts || []) as FilaPost[], rango)

  // Estado honesto por plataforma (§25): falta token, falta Actor, o hay job en marcha.
  const configPorPlataforma = Object.fromEntries(
    PLATAFORMAS.map((p) => [
      p,
      {
        enabled: !!cfg,
        actorConfigurado: !!cfg && !!actorFor(p, 'profile', cfg),
      },
    ])
  )
  const jobsEnMarcha = (jobs || []).filter((j: any) => ['pending', 'processing'].includes(j.status))

  return NextResponse.json({
    source: 'external',
    config: configPorPlataforma,
    jobsEnMarcha,
    ultimaSync: (jobs || []).find((j: any) => j.status === 'completed')?.completed_at || null,
    plataformas,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireRole(tenant)
  if ('error' in auth) return auth.error
  const sb = svc()

  const cfgEnv = await getTenantConfigWithFallback(auth.tenantId, true)
  const cfg = getApifyConfig(cfgEnv)
  if (!cfg) {
    return NextResponse.json(
      { error: 'Apify no configurado: falta el API Token', code: 'apify_no_configurado' },
      { status: 400 }
    )
  }

  let body: { instagram?: string; tiktok?: string } = {}
  try {
    body = (await req.json()) || {}
  } catch {
    // body vacío permitido: usa los handles recordados.
  }
  const { instagram, tiktok, faltan } = await resolverHandles(sb, auth.tenantId, body)

  const resultado: Record<string, { ok: boolean; jobId?: string; error?: string; code?: string }> = {}
  for (const [platform, handle] of [
    ['instagram', instagram],
    ['tiktok', tiktok],
  ] as const) {
    if (!handle) {
      resultado[platform] = { ok: false, error: 'Falta el handle público de la cuenta', code: 'falta_handle' }
      continue
    }
    const r = await createResearchJob(
      sb,
      auth.tenantId,
      platform,
      {
        usernames: [handle],
        resultsLimit: RESEARCH_LIMITS.defaultResultsPerProfile,
        jobType: 'profile',
      },
      cfg
    )
    resultado[platform] = r.ok ? { ok: true, jobId: r.jobId } : { ok: false, error: r.error, code: r.code }
  }

  const ok = Object.values(resultado).some((r) => r.ok)
  return NextResponse.json({ ok, resultado, faltan }, { status: ok ? 200 : 400 })
}
