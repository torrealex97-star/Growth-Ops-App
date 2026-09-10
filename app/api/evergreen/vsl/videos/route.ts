import { NextResponse } from 'next/server'
import { sql, mergeConfig, slugify, DEFAULT_CONFIG } from '@/lib/vsl/db'

export const dynamic = 'force-dynamic'

// Lista todos los vídeos VSL.
export async function GET() {
  try {
    const rows = await sql`
      SELECT id, slug, name, source_url, poster_url, duration_seconds, config, created_at, updated_at
      FROM vsl_videos
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
export async function POST(req: Request) {
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
        WHERE id = ${body.id}
        RETURNING id, slug, name, source_url, poster_url, duration_seconds, config, created_at, updated_at
      `
      if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
      return NextResponse.json({ video: { ...row, config: mergeConfig(row.config) } })
    }

    // Alta: genera slug único a partir del nombre.
    const base = slugify(body.slug || name)
    let slug = base
    for (let i = 2; i < 100; i++) {
      const [exists] = await sql`SELECT 1 FROM vsl_videos WHERE slug = ${slug} LIMIT 1`
      if (!exists) break
      slug = `${base}-${i}`
    }

    const [row] = await sql`
      INSERT INTO vsl_videos (slug, name, source_url, poster_url, duration_seconds, config)
      VALUES (${slug}, ${name}, ${source_url}, ${poster_url}, ${duration}, ${sql.json((config as any) ?? DEFAULT_CONFIG)})
      RETURNING id, slug, name, source_url, poster_url, duration_seconds, config, created_at, updated_at
    `
    return NextResponse.json({ video: { ...row, config: mergeConfig(row.config) } })
  } catch (e) {
    console.error('[vsl/videos POST]', e)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
}

// Borra un vídeo (y en cascada sus sesiones).
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await sql`DELETE FROM vsl_videos WHERE id = ${id}`
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[vsl/videos DELETE]', e)
    return NextResponse.json({ error: 'Error al borrar' }, { status: 500 })
  }
}
