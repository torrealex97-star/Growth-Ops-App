import postgres from 'postgres'

// Cliente postgres compartido para el módulo VSL (mismo patrón que app/api/wa-registros).
// Escrituras con service-role implícito vía POSTGRES_URL (bypassa RLS).
// SOLO servidor: no importar desde componentes cliente.
export const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 1,
  prepare: false,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
})

// Re-export de los tipos/helpers puros para comodidad en el servidor.
export {
  DEFAULT_CONFIG,
  mergeConfig,
  slugify,
  type VslConfig,
  type VslVideo,
} from './types'
