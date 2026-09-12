import postgres from 'postgres'

// Cliente postgres compartido para el módulo VSL, inicializado de forma lazy. Vercel no
// entrega secretos al proceso de build y su CLI los representa como "[SENSITIVE]" al
// descargar el entorno; construir el cliente al importar hacía fallar `next build` antes
// de atender ninguna request. El proxy conserva la API tag `sql\`...\`` y helpers como
// `sql.json`, pero solo valida POSTGRES_URL en runtime.
let client: ReturnType<typeof postgres> | null = null

function getClient(): ReturnType<typeof postgres> {
  if (client) return client
  const url = process.env.POSTGRES_URL
  if (!url || url === '[SENSITIVE]') throw new Error('POSTGRES_URL no está disponible en runtime')
  client = postgres(url, {
    ssl: 'require',
    max: 1,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  })
  return client
}

export const sql = new Proxy((() => undefined) as unknown as ReturnType<typeof postgres>, {
  apply(_target, _thisArg, args) {
    return Reflect.apply(getClient(), undefined, args)
  },
  get(_target, property) {
    const live = getClient()
    const value = Reflect.get(live, property)
    return typeof value === 'function' ? value.bind(live) : value
  },
})

// Re-export de los tipos/helpers puros para comodidad en el servidor.
export { DEFAULT_CONFIG, mergeConfig, slugify, type VslConfig, type VslVideo } from './types'
