// Versión de la API de Meta que usa toda la aplicación.
//
// POR QUÉ ESTÁ AQUÍ Y NO REPETIDA EN SEIS SITIOS. Estaba escrita a mano como 'v21.0' en seis
// archivos, y ese es justo el tipo de constante que se queda obsoleta sin que nadie lo note: Meta
// retira versiones por calendario, no cuando te va mal.
//
// Estado comprobado el 2026-09-13 en la documentación pública de Meta:
//   · Todas las versiones de Marketing API anteriores a v24.0 quedaron DEPRECADAS el 9 de junio de
//     2026. v21.0 — la que había aquí — entra además en retirada el 21 de enero de 2027.
//   · v25.0 es la versión estable publicada el 18 de febrero de 2026, y es la que Meta recomienda a
//     quien venga de versiones antiguas.
//
// Es un valor por defecto: cada subcuenta puede fijar otro en META_API_VERSION desde Integraciones
// (por ejemplo para probar una versión nueva antes de moverlo aquí).
export const META_API_VERSION = 'v25.0'

/**
 * Versiones que Meta ya ha deprecado para Marketing API. Si una subcuenta tiene una de estas
 * escrita a mano, la pantalla lo avisa en vez de dejar que las llamadas empiecen a fallar solas.
 */
const DEPRECATED_META_VERSIONS = ['v15.0', 'v16.0', 'v17.0', 'v18.0', 'v19.0', 'v20.0', 'v21.0', 'v22.0', 'v23.0']

export function isDeprecatedMetaVersion(version: string | undefined | null): boolean {
  if (!version) return false
  return DEPRECATED_META_VERSIONS.includes(version.trim().toLowerCase())
}
