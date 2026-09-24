import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { createResearchJob, getApifyConfig, isApifyEnabled } from '@/lib/social/apify'
import { isSocialJobType, isSocialPlatform, RESEARCH_LIMITS, type ResearchInput } from '@/lib/social/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Investigación externa de perfiles/contenido PÚBLICO de terceros vía proveedor externo (Apify).
// BRIEF §1/§16: esta capa NO toca la cuenta de Instagram conectada (esa es solo API oficial de
// Meta). §7: ejecución asíncrona — se crea el job y se devuelve; el resultado entra por webhook.
// §25: sin token la feature responde 400 'apify_no_configurado' y no rompe nada.

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

// GET → estado de la integración + últimos jobs + resultados ya normalizados.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireRole(tenant)
  if ('error' in auth) return auth.error
  const sb = svc()

  const cfgEnv = await getTenantConfigWithFallback(auth.tenantId, true)
  const enabled = isApifyEnabled(cfgEnv)

  const url = new URL(req.url)
  const jobId = url.searchParams.get('jobId')
  if (jobId) {
    const { data: job } = await sb
      .from('social_research_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 })
    const [{ data: profiles }, { data: posts }] = await Promise.all([
      sb.from('social_profiles').select('*').eq('job_id', job.id).eq('tenant_id', auth.tenantId),
      sb
        .from('social_posts')
        .select('*')
        .eq('job_id', job.id)
        .eq('tenant_id', auth.tenantId)
        .order('views_count', { ascending: false })
        .limit(100),
    ])
    return NextResponse.json({ job, profiles: profiles || [], posts: posts || [] })
  }

  const [jobsRes, profilesRes, postsRes] = await Promise.all([
    sb
      .from('social_research_jobs')
      .select('id, platform, job_type, status, records_processed, error_message, created_at, completed_at')
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false })
      .limit(20),
    sb
      .from('social_profiles')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .order('collected_at', { ascending: false })
      .limit(50),
    sb
      .from('social_posts')
      .select(
        'id, platform, external_id, profile_id, content_type, caption, post_url, thumbnail_url, published_at, views_count, likes_count, comments_count, shares_count, collected_at, source'
      )
      .eq('tenant_id', auth.tenantId)
      .order('published_at', { ascending: false })
      .limit(100),
  ])
  return NextResponse.json({
    enabled,
    jobs: jobsRes.data || [],
    profiles: profilesRes.data || [],
    posts: postsRes.data || [],
    limits: RESEARCH_LIMITS,
  })
}

// POST { platform, jobType, usernames[], resultsLimit? } → crea el job y lanza el Actor (async).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireRole(tenant)
  if ('error' in auth) return auth.error

  const body = (await req.json().catch(() => null)) as {
    platform?: string
    jobType?: string
    usernames?: unknown
    resultsLimit?: number
  } | null
  if (!body) return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  if (!isSocialPlatform(body.platform)) return NextResponse.json({ error: 'plataforma no soportada' }, { status: 400 })
  if (!isSocialJobType(body.jobType))
    return NextResponse.json({ error: 'tipo de investigación no soportado' }, { status: 400 })
  const usernames = Array.isArray(body.usernames)
    ? body.usernames.map((u) => String(u).trim().replace(/^@/, '')).filter(Boolean)
    : []
  if (!usernames.length) return NextResponse.json({ error: 'Falta al menos un usuario a investigar' }, { status: 400 })

  const cfgEnv = await getTenantConfigWithFallback(auth.tenantId, true)
  const cfg = getApifyConfig(cfgEnv)
  if (!cfg) return NextResponse.json({ error: 'Apify no configurado', code: 'apify_no_configurado' }, { status: 400 })

  // GUARD (regla del brief del 21-sep): Apify JAMÁS scrapea las cuentas PROPIAS del tenant.
  // Scrapear la cuenta conectada es exactamente el patrón de bot no oficial que arriesga un
  // baneo; sus métricas van por la API oficial (evergreen/instagram/sync). Se comparan los
  // usernames pedidos contra los handles propios declarados en Integraciones (IG_HANDLE, etc.).
  const propios = [cfgEnv.IG_HANDLE, cfgEnv.TIKTOK_HANDLE, cfgEnv.YOUTUBE_HANDLE]
    .filter(Boolean)
    .map((h) => String(h).trim().replace(/^@/, '').toLowerCase())
  const chocan = usernames.filter((u) => propios.includes(u.toLowerCase()))
  if (chocan.length) {
    return NextResponse.json(
      {
        error: `Las cuentas propias (${chocan.map((c) => `@${c}`).join(', ')}) no se investigan por scraping: sus métricas se traen por la API oficial de la plataforma.`,
        code: 'cuenta_propia_no_va_por_apify',
      },
      { status: 400 }
    )
  }

  const input: ResearchInput = {
    usernames,
    resultsLimit: Number(body.resultsLimit) || cfg.resultsLimit,
    jobType: body.jobType,
  }
  const result = await createResearchJob(svc(), auth.tenantId, body.platform, input, cfg)
  if (!result.ok) {
    const status = result.code === 'limites' ? 429 : result.code === 'sin_actor' ? 400 : 502
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }
  return NextResponse.json({ ok: true, jobId: result.jobId, runId: result.runId })
}
