// URLS QUE EL SERVIDOR PUEDE DESCARGAR (anti-SSRF básico).
//
// Cuando una función del servidor hace `fetch(url)` con una URL que alguien guardó (imágenes de
// referencia, assets de marca…), esa persona decide a qué máquina llama el servidor: localhost, la
// red interna del proveedor o el servicio de metadatos de la nube (169.254.169.254). Se exige https,
// sin credenciales en la URL, y un host que no sea local ni una IP privada/reservada. Esto frena lo
// evidente; no cubre un DNS que apunte a una IP privada (rebinding): para eso, no seguir redirecciones
// a ciegas ni exponer nada interno a la red desde donde corre el servidor.

const PRIVADA_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^(22[4-9]|23\d|24\d|25[0-5])\./,
]

export function esUrlPublicaSegura(valor: string): boolean {
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.lan')) return false
  if (host.includes(':')) {
    // IPv6 literal: loopback, ULA (fc00::/7), link-local (fe80::/10) o IPv4 mapeada.
    return !(
      host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    )
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !PRIVADA_V4.some((re) => re.test(host))
  // Formas numéricas raras (0x7f000001, 2130706433) que el resolvedor interpreta como IPv4.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return false
  return host.includes('.')
}
