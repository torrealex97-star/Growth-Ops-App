import { NextRequest, NextResponse } from 'next/server'
import { type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 60

import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { HISTORY_CAPABILITIES } from '@/lib/integrations/history'
// La implementación de las sincronizaciones de citas vive en lib/integrations/citas-sync y la
// ingesta por-reunión de Fathom en lib/fathom/ingesta: las usan también el cron diario y el
// webhook entrante. Aquí solo queda el enrutado de proveedores y la paginación del histórico —
// tener DOS copias de estas funciones (una por el botón, otra por el webhook) es exactamente la
// deriva que dejó la ingesta de agendas muerta durante días sin que nadie la viera.
import { serviceClient, syncCalendly, syncGhl } from '@/lib/integrations/citas-sync'
import { runMetaAdsSync, runMetaDailySync, runMetaSync } from '@/lib/meta/sync'
import { fetchMeetingsPage, meetingId } from '@/lib/fathom/meetings'
import { procesarMeetingFathom } from '@/lib/fathom/ingesta'

async function requireAdmin(tenant: string) {
  const t = await requireTenant(tenant)
  if ('error' in t) return t
  if (!['admin', 'director'].includes(t.role || '')) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return t
}

async function syncFathom(
  sb: SupabaseClient,
  tenantId: string,
  cfg: Record<string, string>,
  opts: { dryRun?: boolean } = {}
) {
  const key = cfg.FATHOM_API_KEY
  if (!key) throw new Error('Falta FATHOM_API_KEY')
  const dryRun = opts.dryRun === true
  let cursor = ''
  let pages = 0
  const stats = {
    emparejadas: 0,
    ya_importadas: 0,
    a_revision_ambiguas: 0,
    a_revision_sin_candidatos: 0,
    // Ya estaban en la cola de una pasada anterior: ni se reprocesan ni se vuelven a anotar.
    ya_en_revision: 0,
    sin_identificador: 0,
  }
  // Muestra de lo que haría, para que el dry-run sea legible y no solo un recuento.
  const muestra: Array<{ reunion: string; decision: string; detalle?: string }> = []

  while (pages < 100) {
    const { items, nextCursor } = await fetchMeetingsPage(key, cursor)

    for (const meeting of items) {
      const fathomMeetingId = meetingId(meeting)
      if (!fathomMeetingId) {
        // Sin identificador estable no hay forma de ser idempotente ni de anotar el caso en la cola
        // sin duplicarlo en cada pasada, así que se cuenta y se deja fuera.
        stats.sin_identificador++
        continue
      }

      const resultado = await procesarMeetingFathom(sb, tenantId, meeting, { dryRun })
      // Los contadores y las escrituras los lleva la ingesta por reunión (misma lógica que usa el
      // webhook entrante): aquí solo se anotan, con el porqué en la muestra cuando el caso acaba
      // en la cola de revisión.
      if (resultado.kind === 'ya_en_revision') stats.ya_en_revision++
      if (resultado.kind === 'ya_importadas') stats.ya_importadas++
      if (resultado.kind === 'emparejadas') {
        stats.emparejadas++
        if (muestra.length < 20)
          muestra.push({ reunion: fathomMeetingId, decision: `emparejada (${resultado.via ?? 'via'})` })
      }
      if (resultado.kind === 'a_revision_ambiguas') {
        stats.a_revision_ambiguas++
        if (muestra.length < 20)
          muestra.push({ reunion: fathomMeetingId, decision: 'ambigua', detalle: resultado.razon })
      }
      if (resultado.kind === 'a_revision_sin_candidatos') {
        stats.a_revision_sin_candidatos++
        if (muestra.length < 20)
          muestra.push({ reunion: fathomMeetingId, decision: 'sin_candidatos', detalle: resultado.razon })
      }
    }

    pages++
    cursor = nextCursor
    if (!cursor) break
  }

  return { provider: 'fathom', dryRun, pages, ...stats, muestra }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireAdmin(tenant)
    if ('error' in auth) return auth.error
    const body = (await req.json().catch(() => ({}))) as {
      provider?: string
      dryRun?: boolean
      cursor?: string
    }
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    const sb = serviceClient()
    // Meta se carga desde aquí para que el histórico entre por el mismo sitio que el resto: primero
    // las campañas, y después el gasto día a día pidiendo el MÁXIMO que Meta conserva (37 meses) en
    // vez de los 180 días del sync rutinario. Es una carga puntual que el usuario ha pedido
    // explícitamente, así que traer poco sería lo único que no tiene sentido.
    if (body.provider === 'meta') {
      // Credenciales EXPLÍCITAS de esta subcuenta (`cfg`). Antes esto llamaba a ensureConfig(), que
      // vuelca la config en process.env y deja ahí las credenciales de la última subcuenta que pasó
      // por la lambda; con la config pasada como argumento, lo que se sincroniza es lo guardado aquí.
      const dias = HISTORY_CAPABILITIES.meta.sinceDays
      const secrets = [cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET]
      const campañas = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta', trigger: 'historico', secrets },
        () => runMetaSync(sb, auth.tenantId, cfg),
        (r) => ({ rowsWritten: r.synced, failures: r.failures, detail: { cuentas: r.accounts } })
      )
      const diario = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta-daily', trigger: 'historico', secrets },
        () => runMetaDailySync(sb, auth.tenantId, cfg, dias),
        (r) => ({ rowsWritten: r.daysSynced, failures: r.failures, detail: { cuentas: r.accounts, dias } })
      )
      const anuncios = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta-ads', trigger: 'historico', secrets },
        () => runMetaAdsSync(sb, auth.tenantId, cfg),
        (r) => ({ rowsWritten: r.adsSynced, failures: r.failures, detail: { cuentas: r.accounts } })
      )
      return NextResponse.json({ provider: 'meta', campañas, diario, anuncios, sinceDays: dias })
    }
    if (body.provider === 'ghl') return NextResponse.json(await syncGhl(sb, auth.tenantId, cfg))
    if (body.provider === 'calendly') {
      // El histórico completo son cientos de llamadas (evento + invitees + escrituras). Hacerlo
      // dentro de UNA función de 60 s terminaba en 504 y obligaba a recargar. Se procesa una página
      // pequeña por petición y la UI continúa con el cursor opaco de Calendly. Cada lote queda
      // registrado y es idempotente; si la red se corta, se reintenta el mismo cursor sin duplicar.
      const cursor = typeof body.cursor === 'string' && body.cursor.length <= 2048 ? body.cursor : undefined
      const result = await recordSyncRun(
        sb,
        {
          tenantId: auth.tenantId,
          provider: 'calendly',
          job: 'calendly-historico',
          trigger: 'historico',
          secrets: [cfg.CALENDLY_API_TOKEN],
          requiere: { claves: ['CALENDLY_API_TOKEN'], cfg },
        },
        () => syncCalendly(sb, auth.tenantId, cfg, { pageToken: cursor, maxPages: 1, pageSize: 20 }),
        (r) => ({
          rowsWritten: r.imported + r.updated,
          failures: [],
          detail: {
            importadas: r.imported,
            actualizadas: r.updated,
            closerBackfill: r.closerBackfill,
            tieneSiguienteLote: Boolean(r.nextPageToken),
          },
        })
      )
      return NextResponse.json(result)
    }
    if (body.provider === 'fathom')
      return NextResponse.json(await syncFathom(sb, auth.tenantId, cfg, { dryRun: body.dryRun === true }))
    return NextResponse.json({ error: 'Proveedor no soportado' }, { status: 400 })
  } catch (error) {
    if (error instanceof SyncBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
