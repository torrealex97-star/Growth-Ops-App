import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncGhl, syncCalendly } from '@/lib/integrations/citas-sync'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

// CRON de CITAS (Calendly + GHL): pull diario que completa lo que los webhooks no cubren.
// Por qué existe: la sincronización vivía SOLO en el botón manual de Integraciones › history-sync,
// se usó una vez para la importación inicial y jamás hubo planificador — las agendas nuevas dejaron
// de entrar sin que nadie lo viera (ni un run de estos proveedores en integration_sync_runs en días).
// El webhook de GHL es push en tiempo real pero solo de lo que GHL envíe; este cron es el pull que
// repara pérdidas y trae lo que ningún webhook notificó. Mismo patrón que cron/stripe-payments:
// GET global protegido por CRON_SECRET (GitHub Actions pega a la URL estática /api/_/...) que
// recorre TODAS las subcuentas activas con su config EXPLÍCITA.
//
// Ventana INCREMENTAL: solo eventos con inicio en los últimos 14 días (solape amplio para
// reprogramaciones y estados tardíos: confirm/show/no_show llegan después de crear la cita) y
// hasta fin de año siguiente. El upsert es idempotente por external_id: re-leer lo ya importado
// no duplica, actualiza. El botón manual mantiene la ventana completa (5 años atrás).
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    // Presupuesto por subcuenta y POR PROVEEDOR: dos proveedores × ~25 s no caben en el corte de
    // 60 s si comparten un único deadline (la primera pasada de producción lo demostró: Calendly
    // consumió el presupuesto y GHL quedó a 0 páginas). Cada uno recibe el suyo y, si alguno se
    // corta, lo hecho está guardado (upsert idempotente) y la siguiente ejecución continúa.
    const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()

    const porSubcuenta: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      // Config EXPLÍCITA por subcuenta: el token de Calendly de una no puede leer la cuenta de otra.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      if (!cfg.CALENDLY_API_TOKEN && !cfg.GHL_API_TOKEN) {
        // Sin ninguna de las dos no es un fallo: esa subcuenta no agenda por estas vías.
        porSubcuenta[tn.slug] = {
          omitida: true,
          motivo: 'Calendly y GHL no están configurados en esta subcuenta',
        }
        continue
      }
      const resultado: Record<string, unknown> = {}
      try {
        if (cfg.CALENDLY_API_TOKEN) {
          resultado.calendly = await recordSyncRun(
            sb,
            {
              tenantId: tn.id,
              provider: 'calendly',
              job: 'calendly-citas',
              trigger: 'cron',
              secrets: [cfg.CALENDLY_API_TOKEN],
            },
            () => syncCalendly(sb, tn.id, cfg, { desdeInicio: desde, deadlineMs: Date.now() + 25_000 }),
            (r) => ({
              rowsWritten: r.imported + r.updated,
              // Un corte por presupuesto NO es un fallo: es el candado funcionando y queda declarado
              // en detail.cortado. Registrar 'error' aquí falsificaría el panel de salud.
              failures: [],
              detail: { importadas: r.imported, actualizadas: r.updated, paginas: r.pages, cortado: r.cortado },
            })
          )
        }
        if (cfg.GHL_API_TOKEN) {
          resultado.ghl = await recordSyncRun(
            sb,
            {
              tenantId: tn.id,
              provider: 'ghl',
              job: 'ghl-citas',
              trigger: 'cron',
              secrets: [cfg.GHL_API_TOKEN, cfg.GHL_LOCATION_ID],
            },
            () => syncGhl(sb, tn.id, cfg, { desdeInicio: desde, deadlineMs: Date.now() + 25_000 }),
            (r) => ({
              rowsWritten: r.appointmentsImported + r.appointmentsUpdated,
              failures: [],
              detail: {
                citasImportadas: r.appointmentsImported,
                citasActualizadas: r.appointmentsUpdated,
                contactos: r.imported + r.updated,
                cortado: r.cortado,
              },
            })
          )
        }
        porSubcuenta[tn.slug] = resultado
      } catch (e) {
        porSubcuenta[tn.slug] = {
          ...resultado,
          error: e instanceof Error ? e.message : 'Error al sincronizar',
          // Otra ejecución ya estaba en marcha: no es un fallo, es el candado funcionando.
          omitida: e instanceof SyncBusyError,
        }
      }
    }
    return NextResponse.json({ desde, subcuentas: porSubcuenta })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
