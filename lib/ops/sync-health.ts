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

export type Scheduler = 'vercel' | 'pg_cron' | 'manual'

export type SyncDef = {
  id: string
  label: string
  /** Ruta de cron que la ejecuta, relativa al tenant. */
  route: string
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
    table: 'instagram_posts',
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
  | 'sin_datos' // todo en su sitio, pero la tabla está vacía
  | 'manual' // deliberadamente a mano, con su motivo

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
}

export function assessSync(def: SyncDef, facts: HealthFacts): SyncHealth {
  const missingKeys = def.requiredKeys.filter((k) => !facts.configuredKeys.has(k))
  const rows = facts.rowCounts[def.table] ?? null
  const base = { id: def.id, label: def.label, rows, missingKeys }

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

  const programada = def.scheduler === 'vercel' ? facts.vercelScheduled.has(def.route) : facts.pgCronReady
  if (!programada) {
    return {
      ...base,
      status: 'sin_planificador',
      detail:
        def.scheduler === 'vercel'
          ? `La ruta ${def.route} no está en vercel.json, así que nadie la ejecuta.`
          : 'Está diseñada para Supabase pg_cron, y pg_cron/pg_net no están habilitadas en el proyecto: nadie la ejecuta.',
    }
  }

  if (rows === null) {
    return { ...base, status: 'sin_datos', detail: `No se pudo leer ${def.table} para comprobar si hay datos.` }
  }
  if (rows === 0) {
    return {
      ...base,
      status: 'sin_datos',
      detail: `Credenciales y planificador correctos, pero ${def.table} está vacía. Revisa el último error del sync.`,
    }
  }
  // Sin formatear por locale: este módulo corre en servidor y `toLocaleString` depende de que el
  // runtime traiga los datos de ICU completos (en este Node no los trae, así que devolvía '1234'
  // en vez de '1.234' — y en otro entorno devolvería otra cosa). La cifra cruda va en `rows` y es
  // la UI quien la formatea con el locale del navegador, que es donde corresponde.
  return { ...base, status: 'ok', detail: `${rows} filas en ${def.table}.` }
}

export function assessAll(facts: HealthFacts): SyncHealth[] {
  return SYNC_DEFS.map((def) => assessSync(def, facts))
}
