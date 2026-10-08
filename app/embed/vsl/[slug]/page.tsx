import { mergeConfig } from '@/lib/vsl/db'
import { resolvePublicVsl } from '@/lib/vsl/public-video'
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

export default async function VslEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tenant?: string }>
}) {
  const { slug } = await params
  const { tenant } = await searchParams
  const resolution = await resolvePublicVsl(slug, tenant)

  if (resolution.status !== 'found') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-sm text-white/50">
        {resolution.status === 'ambiguous'
          ? 'Este código de inserción es antiguo. Genera uno nuevo desde la subcuenta.'
          : 'Vídeo no encontrado.'}
      </div>
    )
  }
  const { video } = resolution

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
          tenant: video.tenant_slug,
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
