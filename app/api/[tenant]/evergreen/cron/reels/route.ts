import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { generateDraftForMedia, type CompetitorMediaRow } from '@/lib/reels/generate'
import { getTenantConfigWithFallback } from '@/lib/config'
import { businessToday } from '@/lib/dates/business'

export const runtime = 'nodejs'
export const maxDuration = 300

const TIME_BUDGET_MS = 270_000 // deja margen sobre maxDuration=300s

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// CTA por defecto para los borradores automáticos: el cierre de fondo de funnel
// (la "clase" / VSL), salvo que en el futuro se quiera variar por candidato.
const DAILY_CAP = 5

// Genera hasta DAILY_CAP borradores para UNA subcuenta (todas las lecturas/escrituras
// van filtradas/estampadas por tenant_id). startedAt/deadline se comparten entre
// subcuentas para respetar el presupuesto de tiempo global de la ejecución.
async function runForTenant(
  sb: SupabaseClient,
  tenantId: string,
  startedAt: number
): Promise<{ created: number; skipped: number; errors: number; note?: string }> {
  // Hoy en hora del negocio: el cupo diario de borradores se cuenta por el día que ve el equipo.
  const today = businessToday()
  // Clave de Groq de ESTA subcuenta: antes la transcripción la leía de process.env, así que la clave
  // guardada en Integraciones no se usaba y el gasto podía cargarse a la cuenta de otra subcuenta.
  const groqKey = (await getTenantConfigWithFallback(tenantId)).GROQ_API_KEY

  const { count: todaysCount } = await sb
    .from('reel_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('draft_day', today)

  const remaining = DAILY_CAP - (todaysCount || 0)
  if (remaining <= 0) {
    return { created: 0, skipped: 0, errors: 0, note: 'daily cap reached' }
  }

  // Candidatos: media de competencia (de esta subcuenta) que aún no tiene borrador, más reciente primero.
  const { data: existingIds } = await sb.from('reel_drafts').select('source_media_id').eq('tenant_id', tenantId)
  const excluded = (existingIds || []).map((r) => r.source_media_id).filter(Boolean) as string[]

  let query = sb
    .from('ig_competitor_media')
    .select('id, competitor_id, caption, media_url, thumbnail_url, permalink, transcript, ai_analysis, published_at')
    .eq('tenant_id', tenantId)
    .order('published_at', { ascending: false })
    .limit(remaining)
  if (excluded.length) query = query.not('id', 'in', `(${excluded.join(',')})`)

  const { data: candidates, error: candErr } = await query
  if (candErr) throw new Error(candErr.message)
  if (!candidates || candidates.length === 0) {
    return { created: 0, skipped: 0, errors: 0, note: 'no hay reels nuevos de competencia' }
  }

  // Mapa competitor_id → username, para etiquetar el origen.
  const compIds = Array.from(new Set(candidates.map((c) => c.competitor_id)))
  const { data: comps } = await sb
    .from('ig_competitors')
    .select('id, username')
    .eq('tenant_id', tenantId)
    .in('id', compIds)
  const usernameOf = new Map((comps || []).map((c) => [c.id, c.username as string]))

  let created = 0
  let errors = 0
  let skipped = 0

  for (const candidate of candidates as CompetitorMediaRow[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Sin presupuesto de tiempo: deja un esqueleto para regenerar en la próxima pasada.
      await sb.from('reel_drafts').upsert(
        {
          tenant_id: tenantId,
          source_media_id: candidate.id,
          source_permalink: candidate.permalink,
          source_account: usernameOf.get(candidate.competitor_id) || null,
          thumbnail_url: candidate.thumbnail_url,
          caption: candidate.caption,
          status: 'pendiente' as const,
          gen_error: 'pendiente de generar',
          draft_day: today,
        },
        { onConflict: 'source_media_id' }
      )
      skipped++
      continue
    }
    const result = await generateDraftForMedia(
      sb,
      candidate,
      usernameOf.get(candidate.competitor_id) || '',
      undefined,
      tenantId,
      groqKey
    )
    if (result.ok) created++
    else errors++
  }

  return { created, skipped, errors }
}

// Cron diario → mina ~5 reels/día de las cuentas de competencia ya vigiladas
// (ig_competitor_media) y genera un borrador adaptado por cada uno. "Todo y decido
// yo": no hay filtro de viral-score, se coge lo más reciente sin borrador aún.
// Inyecta Authorization: Bearer CRON_SECRET (igual que el resto de crons).
// Vercel Cron pega a una única URL estática, así que este handler recorre TODAS las
// subcuentas activas y corre la generación una vez por cada una, compartiendo el
// presupuesto de tiempo (TIME_BUDGET_MS) entre todas.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const startedAt = Date.now()
  const sb = svc()

  try {
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) return NextResponse.json({ error: tenantsErr.message }, { status: 500 })

    const perTenant: Record<string, { created: number; skipped: number; errors: number; note?: string }> = {}
    for (const tn of tenants || []) {
      perTenant[tn.slug] = await runForTenant(sb, tn.id, startedAt)
    }

    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error en el cron de Reels del día' },
      { status: 500 }
    )
  }
}
