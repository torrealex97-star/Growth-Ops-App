import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Los módulos de lib/ usan el alias '@/*' (definido en tsconfig.json) que solo
// el bundler de Next.js resuelve. `node --test` no conoce ese alias, así que
// este hook de resolución de módulos lo traduce a una ruta relativa a la raíz
// del repo antes de dejar que Node resuelva el archivo normalmente.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const relative = specifier.slice(2)
    // El alias se importa sin extensión (igual que en el código de la app,
    // donde el bundler de Next.js la infiere) — probamos .ts/.tsx igual que
    // hace el resolver de TypeScript antes de dejar que Node falle.
    for (const ext of ['', '.ts', '.tsx']) {
      try {
        const target = pathToFileURL(join(repoRoot, relative + ext)).href
        return await nextResolve(target, context)
      } catch {
        continue
      }
    }
    throw new Error(`No se pudo resolver el alias '@/' para '${specifier}'`)
  }
  // Import relativo SIN extensión entre módulos de lib/ ('./calculator'). TypeScript la infiere y
  // el bundler de Next.js también; Node no, así que un test que importa un módulo que a su vez
  // importa a un vecino fallaba con ERR_MODULE_NOT_FOUND aunque el alias '@/' sí funcionara.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context)
    } catch (err) {
      for (const ext of ['.ts', '.tsx']) {
        try {
          return await nextResolve(specifier + ext, context)
        } catch {
          continue
        }
      }
      throw err
    }
  }
  return nextResolve(specifier, context)
}
