// Tipos y helpers PUROS del módulo VSL (sin dependencias de Node).
// Importable tanto desde componentes cliente como desde el servidor.

// Prueba social: 'off' = sin contador · 'fake' = números inventados (VSL) · 'real' = datos reales (app/herramienta)
type SocialProofMode = 'off' | 'fake' | 'real'

export interface VslConfig {
  showBar: boolean // mostrar barra de progreso
  barColor: string // color de la barra (azul eléctrico por defecto)
  primaryColor: string // color del botón/acentos
  autoplay: boolean // autoplay silenciado al cargar
  muted: boolean // arrancar en mute (necesario para autoplay)
  tryAudioAutoplay: boolean // intentar autoplay CON sonido; si el navegador lo bloquea (Chrome), fallback a mute + overlay
  restartOnUnmute: boolean // al activar el sonido, reiniciar desde el principio (para no perderse el hook)
  lockSeek: boolean // impedir adelantar el vídeo (típico VSL)
  fakeProgress: boolean // barra "acelerada": avanza rápido y da sensación de que queda poco (retención)
  loop: boolean // al terminar, vuelve a empezar automáticamente

  // --- Portada que invita a reproducir (paridad funcional Wistia) ---
  thumbnailMode: 'static' | 'animated' // poster inmediato o preview WebP de Bunny cargada bajo demanda
  thumbnailText: string // contexto breve sobre la portada; vacío = sin texto
  showDurationOnPlay: boolean // duración junto al play antes de iniciar

  // --- Prueba social (contador "viendo ahora" / "ya lo vieron") ---
  socialProof: SocialProofMode // off | fake (inventado) | real (sesiones reales)
  spViewersMin: number // fake: mínimo de "viendo ahora"
  spViewersMax: number // fake: máximo de "viendo ahora"
  spWatchedBase: number // fake: base de "ya lo han visto" (sube poco a poco)// --- Gancho de recuperación (overlay al pausar / intentar salir) ---
  exitHook: boolean // mostrar overlay de "espera, no te vayas"
  exitHookText: string // mensaje del overlay

  // --- CTA programado (paridad Vidalytics): overlay con botón que aparece en un % del vídeo ---
  ctaEnabled: boolean // activar el CTA en el vídeo
  ctaText: string // texto del botón
  ctaUrl: string // destino del botón (relativo o absoluto; se sanea al render)
  ctaAtPercent: number // % del vídeo en el que aparece (0-100)
  ctaPause: boolean // pausar el vídeo cuando aparece (el clásico de Vidalytics)
  ctaOnce: boolean // no volver a mostrarlo si el usuario lo cierra (1 vez por sesión)

  // --- Customización del reproductor (paridad Wistia/PandaVideo) ---
  showCentralPlay: boolean // botón play central grande cuando está pausado
  showFullscreenBtn: boolean // botón de pantalla completa
}

// Azul eléctrico (marca)
const BRAND_BLUE = '#2563EB' // botón / acentos
const BRAND_BLUE_BAR = '#3B82F6' // barra de progreso (un punto más brillante)

export const DEFAULT_CONFIG: VslConfig = {
  showBar: true,
  barColor: BRAND_BLUE_BAR,
  primaryColor: BRAND_BLUE,
  // Poster-first por defecto: mejora LCP/consumo y hace que un play sea una intención real.
  autoplay: false,
  muted: false,
  tryAudioAutoplay: true,
  restartOnUnmute: true,
  lockSeek: true,
  fakeProgress: true,
  loop: true,
  thumbnailMode: 'animated',
  thumbnailText: '',
  showDurationOnPlay: true,
  socialProof: 'off',
  spViewersMin: 8,
  spViewersMax: 24,
  spWatchedBase: 1000,
  exitHook: true,
  exitHookText: 'Espera… justo ahora viene lo más importante 👇',
  ctaEnabled: false,
  ctaText: 'Reservar llamada',
  ctaUrl: '',
  ctaAtPercent: 66,
  ctaPause: true,
  ctaOnce: true,
  showCentralPlay: true,
  showFullscreenBtn: true,
}

interface VslVideo {
  id: string
  slug: string
  name: string
  source_url: string | null
  poster_url: string | null
  duration_seconds: number
  config: VslConfig
  created_at: string
  updated_at: string
}

export function mergeConfig(raw: unknown): VslConfig {
  const c = (raw ?? {}) as Partial<VslConfig>
  return { ...DEFAULT_CONFIG, ...c }
}

/**
 * Artefactos que Bunny genera automáticamente para CADA vídeo de su biblioteca: miniatura estática
 * (thumbnail.jpg), preview animado de 2-3 s (preview.webp) y sprite del storyboard para el scrub
 * con thumbnails. Se derivan de la URL de origen SIN migración ni llamadas a la API. Vive aquí y
 * no en bunny.ts porque lo consume el DASHBOARD en cliente y bunny.ts arrastra node:crypto.
 * Si el vídeo no viene de Bunny (Vimeo/Wistia/YouTube pegados a mano), no hay derivados: null.
 */
export function derivadosDeSource(sourceUrl: string | null | undefined): {
  playlist: string | null
  thumbnail: string | null
  preview: string | null
  storyboard: string | null
} {
  if (!sourceUrl) return { playlist: null, thumbnail: null, preview: null, storyboard: null }
  const m = sourceUrl.match(/^https:\/\/([a-z0-9.-]+)\/([0-9a-f-]{36})\/playlist\.m3u8$/i)
  if (!m) return { playlist: null, thumbnail: null, preview: null, storyboard: null }
  const base = `https://${m[1]}/${m[2]}`
  return {
    playlist: `${base}/playlist.m3u8`,
    thumbnail: `${base}/thumbnail.jpg`,
    preview: `${base}/preview.webp`,
    storyboard: `${base}/storyboard.vtt`,
  }
}

// Slug URL-safe a partir de un nombre.
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'vsl'
  )
}
