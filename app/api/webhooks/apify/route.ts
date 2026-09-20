import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTenantConfigWithFallback } from '@/lib/config'
import { getApifyConfig, processRunResults } from '@/lib/social/apify'

export const runtime = 'nodejs'
export const maxDuration = 60

// Webhook de Apify (brief §8). Flujo del brief: Actor termina → Apify llama aquí →
// 1) la ejecución debe ser conocida (existe un social_research_jobs con ese runId);
// 2) se localiza el jobId; 3-4) runId + defaultDatasetId; 5) dataset; 6) normalización;
// 7) upsert en BD; 8) estado del job; 9) errores guardados.
//
// IDEMPOTENTE (§8): el unique (provider, provider_run_id) impide dos jobs para el mismo run y
// processRunResults devuelve temprano si el job ya está completed. Reentregas duplicadas no
// duplican datos.
//
// Seguridad: el payload de Apify no es confianza suficiente para disparar procesamiento arbitrario
// — solo se procesa si el run pertenece a un job de ESTA app, y las credenciales se leen de la
// subcuenta del job (no del webhook). Estados contemplados: SUCCEEDED, FAILED, ABORTED, TIMED-OUT.

// El webhook no lleva auth de usuario: queda cubierto por (a) solo acepta runs conocidos y
// (b) endpoint de write-only con validación de payload. Opcional: APIFY_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.APIFY_WEBHOOK_SECRET
  if (secret) {
    const got = req.headers.get('x-apify-webhook-secret') || req.headers.get('authorization')?.replace(/^Bearer /, '')
    if (got !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    eventName?: string
    resource?: { id?: string; defaultDatasetId?: string; status?: string; statusMessage?: string }
  } | null
  if (!body?.resource?.id) return NextResponse.json({ error: 'payload inválido' }, { status: 400 })

  const eventName = body.eventName || 'ACTOR.RUN.SUCCEEDED'
  const runId = String(body.resource.id)
  const finalStatus = /SUCCEEDED/i.test(eventName)
    ? 'completed'
    : /FAILED/i.test(eventName)
      ? 'failed'
      : /ABORTED/i.test(eventName)
        ? 'aborted'
        : /TIMED.OUT/i.test(eventName)
          ? 'failed'
          : null
  if (!finalStatus) return NextResponse.json({ ok: true, ignored: `evento no final: ${eventName}` })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // 1-2) ¿Es un run nuestro? (§8 paso 1: "validar que la petición corresponde a una ejecución conocida")
  const { data: job } = await sb
    .from('social_research_jobs')
    .select('id, tenant_id')
    .eq('provider', 'apify')
    .eq('provider_run_id', runId)
    .maybeSingle()
  if (!job) return NextResponse.json({ ok: true, ignored: 'run desconocido' }, { status: 200 })

  // Si el webhook trae datasetId y el job aún no lo tiene, se estampa antes de procesar.
  if (body.resource.defaultDatasetId) {
    await sb
      .from('social_research_jobs')
      .update({ provider_dataset_id: body.resource.defaultDatasetId })
      .eq('id', job.id)
      .is('provider_dataset_id', null)
  }

  // Credenciales de LA SUBCUENTA del job (config cifrada en Integraciones; fallback env).
  const cfgEnv = await getTenantConfigWithFallback(job.tenant_id, true)
  const cfg = getApifyConfig(cfgEnv)
  if (!cfg) {
    await sb
      .from('social_research_jobs')
      .update({
        status: 'failed',
        error_message: 'Apify no configurado en la subcuenta',
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    return NextResponse.json({ ok: true, ignored: 'apify sin configurar' })
  }

  // 3-9)
  const result = await processRunResults(sb, cfg, runId, {
    finalStatus,
    errorMessage: body.resource.statusMessage || undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true, jobId: result.jobId, records: result.records ?? 0 })
}
