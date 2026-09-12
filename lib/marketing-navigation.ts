/** Rutas históricas que deben seguir funcionando después de agrupar Marketing en hubs. */
export const LEGACY_MARKETING_ROUTES: Record<string, string> = {
  '/campaigns': '/marketing/adquisicion/campanas',
  '/attribution': '/marketing/adquisicion/atribucion',
  '/vsl': '/marketing/adquisicion/vsl',
  '/content/reels': '/instagram/reels',
  '/content': '/marketing/contenido',
  '/instagram/contenido': '/marketing/contenido', // Contenido se independizó de Instagram (ahora vive junto a Setting AI)
  '/carruseles': '/instagram/carruseles',
  '/data-health': '/settings/data-health',
}

export function marketingDestinationFor(rest: string): string | null {
  if (LEGACY_MARKETING_ROUTES[rest]) return LEGACY_MARKETING_ROUTES[rest]
  if (rest.startsWith('/carruseles/')) {
    return `/instagram/carruseles/${rest.slice('/carruseles/'.length)}`
  }
  return null
}

export function permissionLocationFor(relPathname: string): string {
  return relPathname
}

export function isAllowedLocation(zones: string[], relLocation: string): boolean {
  return zones.some((zone) => relLocation.startsWith(zone))
}
