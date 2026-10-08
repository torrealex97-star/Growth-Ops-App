import { sql } from './db'

export interface PublicVslVideo {
  id: string
  tenant_id: string
  tenant_slug: string
  slug: string
  name: string
  source_url: string | null
  poster_url: string | null
  duration_seconds: number | null
  config: unknown
}

export type PublicVslResolution =
  { status: 'found'; video: PublicVslVideo } | { status: 'not_found' } | { status: 'ambiguous' }

/**
 * Resuelve el vídeo público sin confiar únicamente en un slug que solo es único dentro del tenant.
 * Los embeds actuales pasan tenant. Los antiguos se conservan únicamente mientras el slug tenga
 * un solo dueño activo; ante una colisión se falla cerrado en vez de servir datos de otra cuenta.
 */
export async function resolvePublicVsl(slug: string, tenant?: string | null): Promise<PublicVslResolution> {
  if (tenant) {
    const rows = await sql<PublicVslVideo[]>`
      SELECT v.id, v.tenant_id, t.slug AS tenant_slug, v.slug, v.name, v.source_url,
             v.poster_url, v.duration_seconds, v.config
      FROM vsl_videos v
      INNER JOIN tenants t ON t.id = v.tenant_id
      WHERE v.slug = ${slug}
        AND t.slug = ${tenant}
        AND v.deleted_at IS NULL
      LIMIT 1
    `
    return rows[0] ? { status: 'found', video: rows[0] } : { status: 'not_found' }
  }

  const rows = await sql<PublicVslVideo[]>`
    SELECT v.id, v.tenant_id, t.slug AS tenant_slug, v.slug, v.name, v.source_url,
           v.poster_url, v.duration_seconds, v.config
    FROM vsl_videos v
    INNER JOIN tenants t ON t.id = v.tenant_id
    WHERE v.slug = ${slug}
      AND v.deleted_at IS NULL
    ORDER BY v.tenant_id
    LIMIT 2
  `
  if (rows.length === 0) return { status: 'not_found' }
  if (rows.length > 1) return { status: 'ambiguous' }
  return { status: 'found', video: rows[0] }
}
