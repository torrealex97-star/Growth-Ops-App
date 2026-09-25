import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncCalendly, syncGhl } from '@/lib/integrations/citas-sync'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

// CRON de CITAS (Calendly + GHL): pull diario que completa lo que los webhooks no cubren.
// Por qué existe: la sincronización vivía SOLO en el botón manual de Integraciones › history-sync,
// se usó una vez para la importación inicial y jamás hubo planificador — las agendas nuevas dejaron
// de entrar sin que nadie lo viera (ni un run de estos proveedores en integration_sync_runs en días).
//
// GHL va en modo 'soloEventos': su sync completa lista TODOS los contactos de la ubicación antes de
// tocar eventos (varios minutos con la cuenta actual) — las dos primeras pasadas con la fase completa
// acabaron en 504 y en un run colgado en 'running'. El modo soloEventos salta esa fase, consulta los
// eventos POR VENTANA TEMPORAL (barato) y crea perezosamente solo el contacto de cada evento nuevo.
// La sync completa (contactos + eventos) sigue en el botón de Integraciones (ventana de 5 años).
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

    // Presupuesto por subcuenta y POR PROVEEDOR, y POR DEBAJO del corte de Vercel. La suma de
    // los dos deadlines NO puede acercarse a los 60 s del maxDuration: antes del primer fetch ya
    // se gastan cold start, updateSession del middleware, la lectura de tenants y la config por
    // subcuenta, y después quedan por escribir los candados de recordSyncRun. El 25-sep el run
    // diario murió con 504 FUNCTION_INVOCATION_TIMEOUT porque 35+25=60 s exactos no dejaban
    // margen: si ambos proveedores agotan su presupuesto, la respuesta nunca llega. Con 20+18
    // (~38 s de trabajo) queda ~20 s de colchón; un corte por presupuesto NO es un fallo (lo
    // hecho está guardado — upsert idempotente — y el run siguiente continúa).
    const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()

    const porSubcuenta: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      // Config EXPLÍCITA por subcuenta: el token de Calendly de una no puede leer la cuenta de otra.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      if (!cfg.CALENDLY_API_TOKEN && !cfg.GHL_API_TOKEN) {
        // Sin credencial no es un fallo: esa subcuenta no agenda vía Calendly ni GHL.
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
            () => syncCalendly(sb, tn.id, cfg, { desdeInicio: desde, deadlineMs: Date.now() + 20_000 }),
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
            () =>
              syncGhl(sb, tn.id, cfg, {
                desdeInicio: desde,
                deadlineMs: Date.now() + 18_000,
                modo: 'soloEventos',
              }),
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
