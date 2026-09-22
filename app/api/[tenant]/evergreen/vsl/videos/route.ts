import { NextResponse } from 'next/server'
import { sql, mergeConfig, slugify, DEFAULT_CONFIG } from '@/lib/vsl/db'
import { requireTenant } from '@/lib/auth/requireTenant'

export const dynamic = 'force-dynamic'

// NOTA: este módulo usa el cliente `postgres` directo (POSTGRES_URL), que bypassa RLS igual
// que el service-role de Supabase, así que el filtro `tenant_id` explícito en cada consulta
// es la única protección contra fugas cruzadas de tenant.

// Lista todos los vídeos VSL del tenant.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  try {
    const rows = await sql`
      SELECT id, slug, name, source_url, poster_url, duration_seconds, config, created_at, updated_at
      FROM vsl_videos
      WHERE tenant_id = ${auth.tenantId} AND deleted_at IS NULL
      ORDER BY created_at DESC
    `
    return NextResponse.json({
      videos: rows.map((r) => ({ ...r, config: mergeConfig(r.config) })),
    })
  } catch (e) {
    console.error('[vsl/videos GET]', e)
    return NextResponse.json({ error: 'Error al cargar vídeos' }, { status: 500 })
  }
}

// Crea o actualiza un vídeo.
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    const name: string = (body.name || '').trim()
    if (!name) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

    const config = mergeConfig(body.config)
    const source_url = body.source_url?.trim() || null
    const poster_url = body.poster_url?.trim() || null
    const duration = Number(body.duration_seconds) || 0

    if (body.id) {
      const [row] = await sql`
        UPDATE vsl_videos SET
          name = ${name},
          source_url = ${source_url},
          poster_url = ${poster_url},
          duration_seconds = ${duration},
          config = ${sql.json(config as any)},
          updated_at = now()
        WHERE id = ${body.id} AND tenant_id = ${auth.tenantId}
        RETURNING id, slug, name, source_url, poster_url, duration_seconds, config, created_at, updated_at
      `
      if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
      return NextResponse.json({ video: { ...row, config: mergeConfig(row.config) } })
    }

    // Alta: genera slug único a partir del nombre, acotado al tenant (dos tenants pueden
    // usar el mismo slug: la página pública de VSL vive bajo la ruta del tenant).
    const base = slugify(body.slug || name)
    let slug = base
    for (let i = 2; i < 100; i++) {
      const [exists] = await sql`SELECT 1 FROM vsl_videos WHERE slug = ${slug} AND tenant_id = ${auth.tenantId} LIMIT 1`
      if (!exists) break
      slug = `${base}-${i}`
    }

    const [row] = await sql`
      INSERT INTO vsl_videos (tenant_id, slug, name, source_url, poster_url, duration_seconds, config)
      VALUES (${auth.tenantId}, ${slug}, ${name}, ${source_url}, ${poster_url}, ${duration}, ${sql.json((config as any) ?? DEFAULT_CONFIG)})
      RETURNING id, slug, name, source_url, poster_url, duration_seconds, config, created_at, updated_at
    `
    return NextResponse.json({ video: { ...row, config: mergeConfig(row.config) } })
  } catch (e) {
    console.error('[vsl/videos POST]', e)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
}

// Borra un vídeo (y en cascada sus sesiones).
export async function DELETE(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    // SOFT DELETE (auditoría §bugs #2): la fila no desaparece — conservan su histórico las
    // sesiones del vídeo en métricas y en el % visto de los contactos.
    await sql`UPDATE vsl_videos SET deleted_at = now(), updated_at = now()
      WHERE id = ${id} AND tenant_id = ${auth.tenantId} AND deleted_at IS NULL`
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[vsl/videos DELETE]', e)
    return NextResponse.json({ error: 'Error al borrar' }, { status: 500 })
  }
}
