// Validación compartida del payload de testimonios (crear y editar), para que POST y
// PATCH acepten exactamente los mismos campos con las mismas reglas.

import { youtubeId, type TestimonioPatch } from "./testimonios-shared"

const TEXT_FIELDS = ["avatar", "sector", "hook", "puntoA", "puntoB", "vehiculo", "cifra"] as const
const BOOL_FIELDS = ["hasRevenue", "consent", "active"] as const

export function parseTestimonioBody(
  body: any
): { patch: TestimonioPatch } | { error: string } {
  const patch: TestimonioPatch = {}

  if (typeof body?.youtubeUrl === "string") {
    const url = body.youtubeUrl.trim()
    if (url && !youtubeId(url)) return { error: "Ese enlace no parece un vídeo de YouTube válido" }
    patch.youtubeUrl = url || null
  }
  if (typeof body?.photoUrl === "string") patch.photoUrl = body.photoUrl.trim() || null

  // El nombre no puede vaciarse; el resto de textos sí pueden volver a null.
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim()
  for (const k of TEXT_FIELDS) {
    if (typeof body?.[k] === "string") patch[k] = body[k].trim() || null
  }
  for (const k of BOOL_FIELDS) {
    if (typeof body?.[k] === "boolean") patch[k] = body[k]
  }
  if (body?.kind === "alumno" || body?.kind === "cliente") patch.kind = body.kind
  if (typeof body?.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    patch.sortOrder = Math.round(body.sortOrder)
  }

  return { patch }
}
