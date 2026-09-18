import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Carga .env.local en un objeto (sin imprimir NINGÚN valor — este módulo solo devuelve claves
 * de configuración para usarlas en llamadas locales). No sobreescribe variables ya presentes
 * en el entorno, igual que dotenv. Devuelve {} si el fichero no existe (CI).
 */
export function leerEnvLocal() {
  const vars = {}
  let texto
  try {
    texto = readFileSync(join(raiz, '.env.local'), 'utf8')
  } catch {
    return vars
  }
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const igual = limpia.indexOf('=')
    if (igual <= 0) continue
    const clave = limpia.slice(0, igual).trim()
    let valor = limpia.slice(igual + 1).trim()
    if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1)
    if (!(clave in process.env)) vars[clave] = valor
  }
  return vars
}
