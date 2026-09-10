// Tipos y helpers puros de testimonios: los usan tanto el servidor como los
// componentes de cliente. No importa Supabase para no arrastrar la service-role
// al bundle del navegador (el acceso a datos vive en lib/testimonios.ts).

export type TestimonioKind = "alumno" | "cliente"

export interface Testimonio {
  id: string
  slug: string
  name: string
  kind: TestimonioKind
  avatar: string | null
  sector: string | null
  photoUrl: string | null
  youtubeUrl: string | null
  hook: string | null
  puntoA: string | null
  puntoB: string | null
  vehiculo: string | null
  cifra: string | null
  /** false = testimonio de proceso: no se le pueden atribuir cifras económicas. */
  hasRevenue: boolean
  consent: boolean
  sortOrder: number
  active: boolean
}

/** Campos editables desde la UI. */
export type TestimonioPatch = Partial<Omit<Testimonio, "id" | "slug">>

/** Normaliza cualquier formato de enlace de YouTube a su ID de vídeo. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  return m ? m[1] : null
}

export function youtubeThumb(url: string | null | undefined): string | null {
  const id = youtubeId(url)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

/** Resumen para pegar en un DM o leer en llamada. */
export function testimonioPitch(t: Testimonio): string {
  return [
    `${t.name}${t.sector ? ` (${t.sector})` : ""}`,
    t.puntoA ? `Antes: ${t.puntoA}` : null,
    t.puntoB ? `Ahora: ${t.puntoB}` : null,
    t.cifra && t.hasRevenue ? `Resultado: ${t.cifra}` : null,
    t.vehiculo ? `Cómo: ${t.vehiculo}` : null,
    t.youtubeUrl ? `Vídeo: ${t.youtubeUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Bloque de contexto que se inyecta en el prompt del generador de guiones cuando se
 * marca que se quiere prueba social. Incluye el aviso de no inventar cifras.
 */
export function testimonioForPrompt(t: Testimonio): string {
  const lines = [
    `NOMBRE: ${t.name}`,
    t.kind === "cliente"
      ? "TIPO: cliente de la agencia (NO alumno de la academia; preséntalo como cliente al que le implementamos IA)."
      : "TIPO: alumno de la academia.",
    t.avatar ? `AVATAR: ${t.avatar}` : null,
    t.sector ? `SECTOR: ${t.sector}` : null,
    t.puntoA ? `PUNTO A (antes): ${t.puntoA}` : null,
    t.puntoB ? `PUNTO B (ahora): ${t.puntoB}` : null,
    t.vehiculo ? `VEHÍCULO (cómo lo consiguió): ${t.vehiculo}` : null,
    t.hasRevenue && t.cifra
      ? `CIFRA EXACTA (úsala literal, no la redondees ni la infles): ${t.cifra}`
      : "SIN CIFRAS ECONÓMICAS: este testimonio todavía no tiene facturación. NO le atribuyas ningún importe ni número de clientes. Úsalo solo como transformación de mentalidad o habilidad.",
  ].filter(Boolean)

  return `PRUEBA SOCIAL A INCLUIR EN EL GUIÓN:
${lines.join("\n")}

CÓMO USARLA:
- Métela como ejemplo real dentro del guión, en la parte del puente al negocio, con la forma "como mi alumno X, que venía de A y hoy está en B".
- Es un caso REAL: no inventes ni adornes nada que no esté arriba. Si algo no aparece, no lo digas.
- Que ocupe 1-2 frases: da autoridad, no se convierte en el tema del reel.`
}
