// Branding por tenant (Fase 10): nombre de marca + acento de color mostrados en el shell,
// resuelto de `tenants.settings.branding` (ver supabase/migrations/20260912110000_tenant_branding.sql).
// `tenants.name` ("Evergreen (plantilla)", "Women Digital Closer") es una etiqueta administrativa
// interna — nunca fue pensada como el nombre visible en el sidebar/login, así que el branding vive
// en su propia clave en vez de reutilizar `name`.

export type TenantAccent = 'brand' | 'pink'
export interface TenantBranding {
  name: string
  accent: TenantAccent
}

// Nombre de plataforma histórico (hardcodeado antes en 9 archivos para TODOS los tenants) — se usa
// como fallback si un tenant no tiene branding configurado en `settings`, y como texto de carga
// antes de que resuelva el fetch (login/layout no pueden esperar a la red para pintar el primer frame).
const DEFAULT_BRAND_NAME = 'Scalix Systems'

export function resolveTenantBranding(settings: unknown): TenantBranding {
  const branding = (settings as { branding?: { name?: unknown; accent?: unknown } } | null | undefined)?.branding
  const name = typeof branding?.name === 'string' && branding.name.trim() ? branding.name : DEFAULT_BRAND_NAME
  const accent: TenantAccent = branding?.accent === 'pink' ? 'pink' : 'brand'
  return { name, accent }
}
