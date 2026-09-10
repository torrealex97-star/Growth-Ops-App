// Tipos y helpers PUROS del módulo VSL (sin dependencias de Node).
// Importable tanto desde componentes cliente como desde el servidor.

// Prueba social: 'off' = sin contador · 'fake' = números inventados (VSL) · 'real' = datos reales (app/herramienta)
export type SocialProofMode = 'off' | 'fake' | 'real'

export interface VslConfig {
  showBar: boolean       // mostrar barra de progreso
  barColor: string       // color de la barra (azul eléctrico IA Winners por defecto)
  primaryColor: string   // color del botón/acentos
  autoplay: boolean      // autoplay silenciado al cargar
  muted: boolean         // arrancar en mute (necesario para autoplay)
  tryAudioAutoplay: boolean // intentar autoplay CON sonido; si el navegador lo bloquea (Chrome), fallback a mute + overlay
  restartOnUnmute: boolean  // al activar el sonido, reiniciar desde el principio (para no perderse el hook)
  lockSeek: boolean      // impedir adelantar el vídeo (típico VSL)
  fakeProgress: boolean  // barra "acelerada": avanza rápido y da sensación de que queda poco (retención)
  loop: boolean          // al terminar, vuelve a empezar automáticamente

  // --- Prueba social (contador "viendo ahora" / "ya lo vieron") ---
  socialProof: SocialProofMode // off | fake (inventado) | real (sesiones reales)
  spViewersMin: number   // fake: mínimo de "viendo ahora"
  spViewersMax: number   // fake: máximo de "viendo ahora"
  spWatchedBase: number  // fake: base de "ya lo han visto" (sube poco a poco)

  // --- Recuperación de caída (overlay al pausar / intentar salir) ---
  exitHook: boolean      // mostrar overlay de "espera, no te vayas"
  exitHookText: string   // mensaje del overlay
}

// Azul eléctrico IA Winners
export const BRAND_BLUE = '#2563EB'      // botón / acentos
export const BRAND_BLUE_BAR = '#3B82F6'  // barra de progreso (un punto más brillante)

export const DEFAULT_CONFIG: VslConfig = {
  showBar: true,
  barColor: BRAND_BLUE_BAR,
  primaryColor: BRAND_BLUE,
  autoplay: true,
  muted: true,
  tryAudioAutoplay: true,
  restartOnUnmute: true,
  lockSeek: true,
  fakeProgress: true,
  loop: true,
  socialProof: 'off',
  spViewersMin: 8,
  spViewersMax: 24,
  spWatchedBase: 1000,
  exitHook: true,
  exitHookText: 'Espera… justo ahora viene lo más importante 👇',
}

export interface VslVideo {
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
