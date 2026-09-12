import { sql, mergeConfig } from '@/lib/vsl/db'
import { VslPlayer } from '@/components/vsl/VslPlayer'

export const dynamic = 'force-dynamic'

// Origen (protocolo + host) de una URL, para poder abrir la conexión (preconnect) cuanto antes.
function originOf(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    return new URL(u).origin
  } catch {
    return null
  }
}

export default async function VslEmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [video] = await sql`
    SELECT slug, name, source_url, poster_url, duration_seconds, config
    FROM vsl_videos WHERE slug = ${slug} LIMIT 1
  `

  if (!video) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-sm text-white/50">
        Vídeo no encontrado.
      </div>
    )
  }

  const mediaOrigins = Array.from(
    new Set([originOf(video.source_url), originOf(video.poster_url)].filter(Boolean) as string[])
  )

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      {/* Abrir la conexión al CDN del vídeo antes de que arranque el player (ahorra el handshake).
          Sin crossOrigin: el <video>/preload van en modo no-cors y así se reutiliza la conexión. */}
      {mediaOrigins.map((o) => (
        <link key={o} rel="preconnect" href={o} />
      ))}
      {/* El póster se muestra al instante (sin negro). */}
      {video.poster_url && <link rel="preload" as="image" href={video.poster_url} />}
      {/* Empezar a descargar el vídeo cuanto antes, en paralelo con la carga del JS. */}
      {video.source_url && <link rel="preload" as="video" href={video.source_url} />}
      <VslPlayer
        embed
        video={{
          slug: video.slug,
          source_url: video.source_url,
          poster_url: video.poster_url,
          duration_seconds: Number(video.duration_seconds) || 0,
          config: mergeConfig(video.config),
        }}
      />
    </div>
  )
}
