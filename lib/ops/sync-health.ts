// Salud de las sincronizaciones: ¿tiene credenciales, tiene quién la dispare, y ha traído datos?
//
// POR QUÉ EXISTE. El síntoma era "Meta no sincroniza". La causa no era ni las credenciales (están
// puestas) ni el código: esas rutas se diseñaron para dispararse desde Supabase `pg_cron`, pg_cron
// NO está instalada en el proyecto (ni pg_net, que es lo que le permitiría hacer llamadas HTTP), y
// tampoco están declaradas en vercel.json. Seis sincronizaciones sin ningún planificador, fallando
// de la forma más silenciosa posible: no fallan, simplemente nunca se ejecutan.
//
// Un panel que dijera "Meta: conectado" mirando solo las credenciales habría mentido durante meses.
// Aquí "conectado" exige las tres cosas.

import type { SyncRunSummary } from '@/lib/integrations/sync-runs'

export type Scheduler = 'vercel' | 'pg_cron' | 'manual'

export type SyncDef = {
  id: string
  label: string
  /**
   * Ruta de cron que la ejecuta, relativa al tenant. `null` = no hay ruta programable: se dispara
   * desde la interfaz. Distinguirlo evita declarar rutas de cron que no existen para que una
   * sincronización manual "encaje" en el catálogo.
   */
  route: string | null
  /** Tabla que debería llenarse. Es la prueba de que la sincronización funciona de verdad. */
  table: string
  /** Claves de configuración mínimas. Sin ellas no puede ni intentarlo. */
  requiredKeys: string[]
  /** Quién la dispara según el DISEÑO. Si el planificador no existe, la sincronización no corre. */
  scheduler: Scheduler
  /** Por qué es manual, cuando lo es. Obliga a justificarlo en vez de dejarlo sin programar por olvido. */
  manualReason?: string
}

// Catálogo declarado. Un test comprueba que cubre TODAS las rutas de cron con GET: así no se puede
// añadir una sincronización nueva sin decir quién la dispara.
export const SYNC_DEFS: SyncDef[] = [
  {
    id: 'meta',
    label: 'Meta Ads — campañas y gasto del mes',
    route: 'cron/meta',
    table: 'campaigns',
    requiredKeys: ['META_ACCESS_TOKEN'],
    // Movida de pg_cron a Vercel: pg_cron no está instalada, así que "cada 30 min" era en realidad
    // "nunca". Diario es peor que cada 30 minutos, pero infinitamente mejor que no ejecutarse.
    scheduler: 'vercel',
  },
  {
    id: 'meta-daily',
    label: 'Meta Ads — gasto diario por campaña',
    route: 'cron/meta-daily',
    table: 'campaign_daily',
    requiredKeys: ['META_ACCESS_TOKEN'],
    scheduler: 'vercel',
  },
  {
    id: 'meta-ads',
    label: 'Meta Ads — anuncios',
    route: 'cron/meta-ads',
    table: 'campaign_ads',
    requiredKeys: ['META_ACCESS_TOKEN'],
    scheduler: 'vercel',
  },
  {
    id: 'instagram',
    label: 'Instagram orgánico',
    route: 'cron/instagram',
    // `ig_media` es la tabla que ESCRIBE el cron (y la que lee la pantalla de Instagram). Aquí ponía
    // `instagram_posts`, que no existe en ninguna migración: el panel iba a decir "sin datos" para
    // siempre por contar una tabla inexistente, justo el fallo que este módulo existe para evitar.
    table: 'ig_media',
    requiredKeys: ['INSTAGRAM_ACCESS_TOKEN'],
    scheduler: 'vercel',
  },
  {
    id: 'analyze-calls',
    label: 'Análisis de llamadas con IA',
    route: 'cron/analyze-calls',
    table: 'appointments',
    requiredKeys: ['ANTHROPIC_API_KEY'],
    scheduler: 'vercel',
  },
  {
    id: 'ai-insights',
    label: 'Avisos proactivos',
    route: 'cron/ai-insights',
    table: 'ai_insights',
    requiredKeys: [],
    scheduler: 'vercel',
  },
  {
    id: 'monthly',
    label: 'Gastos mensuales automáticos',
    route: 'cron/monthly',
    table: 'expenses',
    requiredKeys: [],
    scheduler: 'vercel',
  },
  {
    id: 'reminders',
    label: 'Cuotas vencidas',
    route: 'cron/reminders',
    table: 'collections',
    requiredKeys: [],
    scheduler: 'vercel',
  },
  {
    id: 'sequra-morosos',
    label: 'Morosos de SeQura',
    route: 'cron/sequra-morosos',
    table: 'sequra_delinquent_customers',
    requiredKeys: ['SEQURA_MCP_TOKEN'],
    scheduler: 'vercel',
  },
  {
    id: 'reels',
    label: 'Borradores de reels del día',
    route: 'cron/reels',
    table: 'reel_drafts',
    requiredKeys: [],
    scheduler: 'manual',
    manualReason: 'Genera borradores de contenido: se lanza cuando el equipo los va a revisar, no en automático.',
  },
  {
    // Stripe no tiene cron: se lanza desde Configuración › Integraciones › Stripe. Está en el
    // catálogo para que su tarjeta pueda decir la verdad sobre los datos (nunca ejecutada / falló /
    // corrió y no trajo nada), que es justo lo que no podía decir al no estar declarada.
    id: 'stripe-customers',
    label: 'Stripe — base de clientes y suscripciones',
    // La ruta de cron EXISTE (app/api/[tenant]/evergreen/cron/stripe-customers) y se declara aquí
    // para que no quede huérfana. Sigue siendo `manual` porque NO está en vercel.json: el proyecto
    // está en plan Hobby y ya hay nueve crons declarados, así que añadir un décimo sin saber cuántos
    // ejecuta Vercel de verdad podría desplazar Meta, Instagram o los recordatorios. `scheduler`
    // manda sobre `route` en assessSync, así que declararla no pinta un verde que no le corresponde.
    route: 'cron/stripe-customers',
    table: 'stripe_customers',
    requiredKeys: ['STRIPE_SECRET_KEY'],
    scheduler: 'manual',
    manualReason:
      'Se actualiza desde Integraciones › Stripe cuando lo pides. La ruta de cron ya está escrita: para automatizarla, añade "/api/_/evergreen/cron/stripe-customers" a vercel.json — antes comprueba en Vercel cuántos crons admite el plan, porque ya hay nueve declarados.',
  },
  {
    id: 'youtube-backfill',
    label: 'Backfill de reels antiguos a YouTube',
    route: 'cron/youtube-backfill',
    table: 'reel_drafts',
    requiredKeys: ['YOUTUBE_REFRESH_TOKEN'],
    scheduler: 'manual',
    manualReason: 'Consume cupo diario de la API de YouTube: se lanza a mano para controlar el gasto de cuota.',
  },
]

export type SyncStatus =
  | 'ok' // credenciales, planificador y datos
  | 'sin_credenciales' // no puede ni intentarlo
  | 'sin_planificador' // credenciales puestas y NADIE la dispara: el fallo silencioso
  | 'sync_fallido' // se ejecutó y FALLÓ: el historial guarda el motivo
  | 'sin_datos' // todo en su sitio, pero la tabla está vacía
  | 'manual' // deliberadamente a mano, con su motivo

/**
 * Estado de los DATOS de una sincronización. "Vacío" no es un estado: son cinco distintos, con
 * cinco acciones distintas, y colapsarlos es lo que hacía que un token caducado se leyera como
 * "esta cuenta no tiene campañas".
 */
export type DataState =
  | 'NOT_CONNECTED' // faltan credenciales: no puede ni intentarlo
  | 'SYNC_FAILED' // la última ejecución falló (el motivo está en el historial)
  | 'SYNC_PENDING' // nunca se ha ejecutado, o está ejecutándose ahora
  | 'SYNC_SUCCESS_NO_DATA' // corrió bien y el proveedor no devolvió nada
  | 'DATA_STALE' // hay datos, pero la última ejecución correcta es vieja
  | 'DATA_AVAILABLE' // hay datos y son recientes

/** Pasada esta ventana sin una ejecución correcta, los datos se consideran viejos (cron diario). */
export const DATA_STALE_MS = 48 * 60 * 60 * 1000

export type SyncHealth = {
  id: string
  label: string
  status: SyncStatus
  /**
   * Explicación en una frase, lista para pintar. Nunca un código a interpretar.
   * No aplica formato de locale a los números: eso lo hace la UI (ver `rows`).
   */
  detail: string
  rows: number | null
  missingKeys: string[]
  /** Estado de los datos, con la causa real cuando están vacíos. */
  dataState: DataState
  /** Cuándo terminó (o empezó) la última ejecución registrada. */
  lastRunAt: string | null
  /** Mensaje del último fallo, ya redactado. `null` si la última ejecución fue bien. */
  lastError: string | null
  /** Código estable del último fallo, para poder dar el arreglo concreto sin parsear el mensaje. */
  lastErrorCode: string | null
}

export type HealthFacts = {
  /** Claves de configuración presentes en esta subcuenta (o en el entorno). */
  configuredKeys: Set<string>
  /** Filas por tabla. `null` = no se pudo leer, que NO es lo mismo que 0. */
  rowCounts: Record<string, number | null>
  /** Rutas declaradas en vercel.json. */
  vercelScheduled: Set<string>
  /** ¿Está pg_cron operativa? Necesita la extensión Y pg_net para poder llamar por HTTP. */
  pgCronReady: boolean
  /** Última ejecución registrada de cada sincronización (`integration_sync_runs`). */
  lastRuns?: Record<string, SyncRunSummary | null>
}

/**
 * Estado de los datos: por qué la tabla está como está. El orden importa — sin credenciales no hay
 * ejecución posible, y una ejecución fallida explica un vacío mucho mejor que el vacío en sí.
 */
export function assessDataState(
  missingKeys: string[],
  rows: number | null,
  lastRun: SyncRunSummary | null | undefined,
  now: number
): DataState {
  if (missingKeys.length > 0) return 'NOT_CONNECTED'
  if (lastRun?.status === 'running') return 'SYNC_PENDING'
  if (!lastRun) {
    // Sin historial de ejecuciones no se puede juzgar la frescura: si HAY filas, decir "vacía"
    // sería falso, y decir "vieja" también sería inventado. Lo único cierto es que hay datos.
    return rows && rows > 0 ? 'DATA_AVAILABLE' : 'SYNC_PENDING'
  }
  if (lastRun.status === 'error' || lastRun.status === 'timeout') return 'SYNC_FAILED'
  // `rows` es lo que hay en la tabla; si no se pudo leer, lo que la propia ejecución dice que
  // escribió es el mejor dato disponible — y 0 filas escritas es un dato, no un hueco.
  const effective = rows ?? lastRun.rowsWritten ?? null
  if (effective === 0) return 'SYNC_SUCCESS_NO_DATA'
  const at = Date.parse(lastRun.finishedAt || lastRun.startedAt)
  if (Number.isNaN(at) || now - at > DATA_STALE_MS) return 'DATA_STALE'
  return effective === null ? 'SYNC_PENDING' : 'DATA_AVAILABLE'
}

export function assessSync(def: SyncDef, facts: HealthFacts, now = Date.now()): SyncHealth {
  const missingKeys = def.requiredKeys.filter((k) => !facts.configuredKeys.has(k))
  const rows = facts.rowCounts[def.table] ?? null
  const lastRun = facts.lastRuns?.[def.id] ?? null
  const dataState = assessDataState(missingKeys, rows, lastRun, now)
  const base = {
    id: def.id,
    label: def.label,
    rows,
    missingKeys,
    dataState,
    lastRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
    lastError: lastRun && (lastRun.status === 'error' || lastRun.status === 'timeout') ? lastRun.errorMessage : null,
    lastErrorCode: lastRun && (lastRun.status === 'error' || lastRun.status === 'timeout') ? lastRun.errorCode : null,
  }

  if (missingKeys.length > 0) {
    return {
      ...base,
      status: 'sin_credenciales',
      detail: `Falta configurar ${missingKeys.join(', ')} en Integraciones.`,
    }
  }

  if (def.scheduler === 'manual') {
    return { ...base, status: 'manual', detail: def.manualReason || 'Se lanza a mano a propósito.' }
  }

  const programada =
    def.scheduler === 'vercel' ? !!def.route && facts.vercelScheduled.has(def.route) : facts.pgCronReady
  if (!programada) {
    return {
      ...base,
      status: 'sin_planificador',
      detail:
        def.scheduler === 'vercel'
          ? `La ruta ${def.route ?? '(sin declarar)'} no está en vercel.json, así que nadie la ejecuta.`
          : 'Está diseñada para Supabase pg_cron, y pg_cron/pg_net no están habilitadas en el proyecto: nadie la ejecuta.',
    }
  }

  // La última ejecución FALLÓ. Esto manda sobre el nº de filas: aunque haya datos de antes, lo que
  // el usuario necesita saber es que la sincronización está caída y por qué.
  if (dataState === 'SYNC_FAILED') {
    return {
      ...base,
      status: 'sync_fallido',
      detail: base.lastError
        ? `La última sincronización falló: ${base.lastError}`
        : 'La última sincronización falló y no dejó mensaje.',
    }
  }

  if (dataState === 'SYNC_PENDING') {
    return {
      ...base,
      status: 'sin_datos',
      detail:
        lastRun?.status === 'running'
          ? `Sincronizando ${def.table} ahora mismo.`
          : rows === null
            ? `No se pudo leer ${def.table} para comprobar si hay datos.`
            : `Todavía no se ha ejecutado ninguna sincronización, así que ${def.table} está vacía.`,
    }
  }

  if (dataState === 'SYNC_SUCCESS_NO_DATA') {
    return {
      ...base,
      status: 'sin_datos',
      detail: `La última sincronización terminó bien pero no trajo ninguna fila: ${def.table} sigue vacía porque el proveedor no devolvió datos.`,
    }
  }

  if (dataState === 'DATA_STALE') {
    return {
      ...base,
      status: 'sin_datos',
      detail: `Hay datos en ${def.table}, pero la última sincronización correcta es de hace más de dos días.`,
    }
  }

  // Sin formatear por locale: este módulo corre en servidor y `toLocaleString` depende de que el
  // runtime traiga los datos de ICU completos (en este Node no los trae, así que devolvía '1234'
  // en vez de '1.234' — y en otro entorno devolvería otra cosa). La cifra cruda va en `rows` y es
  // la UI quien la formatea con el locale del navegador, que es donde corresponde.
  return {
    ...base,
    status: 'ok',
    detail:
      rows === null
        ? `La última sincronización escribió ${lastRun?.rowsWritten ?? 0} filas en ${def.table} (no se pudo contar la tabla).`
        : `${rows} filas en ${def.table}.`,
  }
}

export function assessAll(facts: HealthFacts, now = Date.now()): SyncHealth[] {
  return SYNC_DEFS.map((def) => assessSync(def, facts, now))
}
