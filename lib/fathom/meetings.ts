// Acceso a la API de reuniones de Fathom y formato de su contenido.
//
// Está aquí y no dentro del sync porque hay DOS sitios que necesitan lo mismo: el sync de historial
// (recorre todas las reuniones) y la resolución manual de la cola de revisión (busca UNA reunión
// concreta que una persona acaba de asignar a una cita). Antes de extraerlo, el formato de la
// transcripción vivía inline en el sync; duplicarlo habría dejado dos versiones del mismo texto
// divergiendo.
//
// Solo se usan parámetros documentados del endpoint (`limit`, `cursor`, `include_summary`,
// `include_transcript`). No se inventa un filtro por id: si la API lo soporta, no consta, y pedir un
// parámetro inexistente devolvería la primera página como si fuera el resultado de la búsqueda.

export type FathomMeeting = Record<string, unknown>

const MEETINGS_URL = 'https://api.fathom.ai/external/v1/meetings'

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** Identificador estable de una reunión: el que se estampa en `appointments.fathom_meeting_id`. */
export function meetingId(meeting: FathomMeeting): string | null {
  return text(meeting.share_url) || text(meeting.url)
}

/** Resumen de Fathom en markdown, o null si esa reunión no lo trae. */
export function meetingSummary(meeting: FathomMeeting): string | null {
  const summary = meeting.default_summary as FathomMeeting | undefined
  return text(summary?.markdown_formatted)
}

/**
 * Transcripción en texto plano, una línea por intervención. null si la reunión no trae
 * transcripción — que NO es lo mismo que una transcripción vacía, y por eso el sync distingue
 * `transcript_status` 'listo' de 'no_aplica'.
 */
export function meetingTranscript(meeting: FathomMeeting): string | null {
  if (!Array.isArray(meeting.transcript)) return null
  return (meeting.transcript as FathomMeeting[])
    .map((line) => {
      const speaker = line.speaker as FathomMeeting | undefined
      return `[${text(line.timestamp) || ''}] ${text(speaker?.display_name) || 'Speaker'}: ${text(line.text) || ''}`
    })
    .join('\n')
}

export async function fetchMeetingsPage(
  apiKey: string,
  cursor: string
): Promise<{ items: FathomMeeting[]; nextCursor: string }> {
  const url = new URL(MEETINGS_URL)
  url.searchParams.set('limit', '100')
  url.searchParams.set('include_summary', 'true')
  url.searchParams.set('include_transcript', 'true')
  if (cursor) url.searchParams.set('cursor', cursor)
  const response = await fetch(url, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await response.json().catch(() => ({}))) as {
    items?: FathomMeeting[]
    next_cursor?: string | null
    message?: string
  }
  if (!response.ok) throw new Error(body.message || `Fathom respondió ${response.status}`)
  return { items: body.items ?? [], nextCursor: body.next_cursor || '' }
}

/**
 * Busca una reunión por su identificador recorriendo páginas hasta encontrarla.
 *
 * Devuelve `null` si no aparece en las `maxPages` primeras páginas: con 100 por página son las 2.000
 * reuniones más recientes. Que devuelva null NO significa que la reunión no exista — significa que
 * está más atrás de lo que se ha buscado, y quien llama tiene que decirlo así en pantalla en vez de
 * presentarlo como "sin transcripción".
 */
export async function findMeetingById(
  apiKey: string,
  id: string,
  opts: { maxPages?: number } = {}
): Promise<FathomMeeting | null> {
  const maxPages = opts.maxPages ?? 20
  let cursor = ''
  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await fetchMeetingsPage(apiKey, cursor)
    const found = items.find((m) => meetingId(m) === id)
    if (found) return found
    if (!nextCursor) return null
    cursor = nextCursor
  }
  return null
}
