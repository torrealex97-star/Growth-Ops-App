// Qué sincronizaciones tienen planificador de verdad, leído de vercel.json.
//
// Se importa el propio vercel.json en vez de mantener una lista paralela: una lista escrita a mano se
// habría desincronizado en el primer cron añadido, y ese desajuste es justo el que dejó seis
// sincronizaciones sin ejecutarse durante meses sin que ninguna pantalla lo dijera.
import vercelConfig from '@/vercel.json'

const CRON_PREFIX = /^\/api\/[^/]+\/evergreen\//

/** Rutas programadas, en la misma forma que las declara SYNC_DEFS (`cron/meta`). */
export const VERCEL_CRON_ROUTES: Set<string> = new Set(
  ((vercelConfig as { crons?: { path: string }[] }).crons ?? []).map((c) => c.path.replace(CRON_PREFIX, ''))
)

/**
 * pg_cron NO está instalada en el proyecto de Supabase (ni pg_net, que es lo que le permitiría hacer
 * llamadas HTTP). Verificado el 2026-09-13 contra producción con `list_extensions`. Mientras siga
 * así, cualquier sincronización que dependa de pg_cron no se ejecuta nunca.
 *
 * Si algún día se instalan, hay que cambiar esto a true — y el test de sincronizaciones obliga a que
 * cada ruta declare quién la dispara, así que el olvido se nota.
 */
export const PG_CRON_READY = false
