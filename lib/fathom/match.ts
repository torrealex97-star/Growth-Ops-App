// Decisión de a qué cita pertenece una reunión de Fathom.
//
// Está aislada del sync a propósito: es la parte con reglas, y así se puede probar sin red ni base
// de datos. El sync solo obedece lo que esta función decide.
//
// EL PROBLEMA QUE RESUELVE. La versión anterior, cuando había varias citas candidatas en una
// ventana de ±12 h, escribía la transcripción en TODAS, con un comentario que lo presentaba como
// la opción prudente ("mejor que arriesgar una asociación incorrecta"). No lo era:
//   - La misma llamada quedaba duplicada en N citas, así que el análisis de IA y las herramientas
//     de Voice of Customer la contaban N veces.
//   - El mismo fathom_meeting_id quedaba estampado en N filas.
//   - En el re-sync siguiente, la comprobación de "ya importada" encontraba una y saltaba: parecía
//     idempotente habiendo dejado N-1 filas con una llamada que no ocurrió ahí.
// Atribuir una llamada a una cita donde no pasó no es más prudente que no atribuirla. Ante la duda,
// esto NO decide: manda el caso a una cola para que lo resuelva una persona.

export type Candidate = {
  id: string
  /** ISO. Hora de la cita en nuestra base. */
  appointmentDatetime: string
  /** fathom_meeting_id ya estampado en esta cita, si lo hay. */
  fathomMeetingId?: string | null
}

export type MeetingInput = {
  /** Identificador estable de la reunión en Fathom (share_url/url). */
  fathomMeetingId: string | null
  /** ISO. Inicio de la reunión según Fathom. */
  startedAt: string | null
  /** Email del invitado externo, ya normalizado a minúsculas. */
  email: string | null
}

export type MatchDecision =
  /** Emparejamiento seguro: se puede escribir. */
  | { kind: 'match'; appointmentId: string; via: 'fathom_id' | 'email_y_hora' }
  /** Ya importada en un sync anterior. No es un fallo ni trabajo pendiente. */
  | { kind: 'ya_importada'; appointmentId: string }
  /** Hay más de un candidato plausible: no se decide, va a revisión humana. */
  | { kind: 'ambigua'; candidateIds: string[]; reason: string }
  /** No hay a qué vincularla. Tampoco se inventa nada. */
  | { kind: 'sin_candidatos'; reason: string }

/**
 * Ventana en la que una cita se considera candidata de una reunión, en minutos.
 * 12 h (la anterior) es demasiado: un contacto con una llamada por la mañana y otra por la tarde
 * caía en la misma ventana, y ahí es donde se producía la escritura múltiple. 90 minutos cubre el
 * caso real (la reunión empieza algo antes o después de la hora agendada) sin barrer el día entero.
 */
export const MATCH_WINDOW_MINUTES = 90

/**
 * Margen para considerar que dos candidatos están "igual de cerca". Si la diferencia entre el mejor
 * y el segundo es menor que esto, elegir uno sería tirar una moneda.
 */
export const TIE_MARGIN_MINUTES = 15

const minutesApart = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000

export function decideMatch(meeting: MeetingInput, candidates: Candidate[]): MatchDecision {
  // 1) Determinista: si esta reunión ya está estampada en una cita, es esa y no hay nada que hacer.
  if (meeting.fathomMeetingId) {
    const already = candidates.filter((c) => c.fathomMeetingId === meeting.fathomMeetingId)
    if (already.length > 0) return { kind: 'ya_importada', appointmentId: already[0].id }
  }

  if (!meeting.startedAt) {
    return { kind: 'sin_candidatos', reason: 'La reunión de Fathom no trae hora de inicio.' }
  }
  if (!meeting.email) {
    return { kind: 'sin_candidatos', reason: 'La reunión de Fathom no trae email del invitado externo.' }
  }
  if (candidates.length === 0) {
    return { kind: 'sin_candidatos', reason: 'No hay ninguna cita de ese contacto cerca de esa hora.' }
  }

  // 2) Por proximidad, pero solo si el ganador es claramente el más cercano.
  const startedAt = meeting.startedAt
  const inWindow = candidates
    .map((c) => ({ c, diff: minutesApart(c.appointmentDatetime, startedAt) }))
    .filter((x) => x.diff <= MATCH_WINDOW_MINUTES)
    .sort((a, b) => a.diff - b.diff)

  if (inWindow.length === 0) {
    return {
      kind: 'sin_candidatos',
      reason: `Hay citas de ese contacto, pero ninguna dentro de ${MATCH_WINDOW_MINUTES} minutos de la reunión.`,
    }
  }
  if (inWindow.length === 1) {
    return { kind: 'match', appointmentId: inWindow[0].c.id, via: 'email_y_hora' }
  }

  const [best, second] = inWindow
  if (second.diff - best.diff < TIE_MARGIN_MINUTES) {
    return {
      kind: 'ambigua',
      candidateIds: inWindow.map((x) => x.c.id),
      reason:
        `Hay ${inWindow.length} citas de ese contacto a una distancia parecida de la reunión ` +
        `(${best.diff.toFixed(0)} y ${second.diff.toFixed(0)} minutos). Elegir una sería adivinar.`,
    }
  }
  // Un candidato destaca claramente sobre el resto: es un emparejamiento, no un empate.
  return { kind: 'match', appointmentId: best.c.id, via: 'email_y_hora' }
}
