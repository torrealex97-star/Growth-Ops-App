// Métricas e insights de conversaciones de Instagram para el panel de "Conversaciones" (Setting AI).
//
// Principio: nunca inventar un resultado. Una conversación se cuenta como "generó agenda/venta"
// SOLO cuando se pudo enlazar con un contacto real de la BD (contacts.instagram) que además tiene
// una cita/venta registrada — es un hecho verificable, no una suposición. Cuando el username del
// participante no encaja con ningún contacto, la conversación queda en "sin contacto vinculado":
// el fallback es detectar (por texto, de forma explícita y marcada como tal) si se envió un enlace
// de agenda, pero eso NUNCA se presenta como "agendó" — son señales distintas y la UI las separa.
import type { IgConversation } from '@/lib/instagram/client'

export function normalizarUsuarioIg(u: string | null | undefined): string | null {
  if (!u) return null
  const limpio = u.trim().toLowerCase().replace(/^@/, '')
  return limpio || null
}

// Patrón de enlaces de agenda típicos (Calendly, Cal.com, GHL) — señal de "se ofreció agendar" en el
// propio texto, no de que la persona realmente agendara.
const PATRON_ENLACE_AGENDA = /calendly\.com|cal\.com\/|\.gohighlevel\.com\/widget|book(ing)?[a-z]*\.(com|app)/i

export function detectarEnlaceAgendaEnMensajes(mensajes: { text?: string }[]): boolean {
  return mensajes.some((m) => !!m.text && PATRON_ENLACE_AGENDA.test(m.text))
}

/** ¿Contestó el equipo tras el último mensaje del lead? (embudo de DM: respondido vs ignorado). */
export function respondidoDespuesDelLead(mensajes: { from: string }[]): boolean {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i]
    if (!m) continue
    if (m.from === 'agente') return true
    if (m.from === 'lead') return false
  }
  return false
}

export function detectarEnlaceAgendaEnTexto(conv: IgConversation): boolean {
  return detectarEnlaceAgendaEnMensajes(conv.messages)
}

export type ContactoIg = { id: string; instagram: string | null }

/** conversationId -> contactId | null (null = ningún contacto de la subcuenta usa ese username). */
export function emparejarConConTactos(
  conversations: IgConversation[],
  contactos: ContactoIg[]
): Map<string, string | null> {
  const porUsuario = new Map<string, string>()
  for (const c of contactos) {
    const u = normalizarUsuarioIg(c.instagram)
    // Si dos contactos comparten el mismo username (dato sucio), el primero gana — no hay forma de
    // saber cuál es el real sin más señales, y sobreescribir en silencio sería peor.
    if (u && !porUsuario.has(u)) porUsuario.set(u, c.id)
  }
  const resultado = new Map<string, string | null>()
  for (const conv of conversations) {
    const u = normalizarUsuarioIg(conv.participant)
    resultado.set(conv.id, (u && porUsuario.get(u)) || null)
  }
  return resultado
}

export type MetricaConversacion = {
  conversationId: string
  participant?: string
  matchedContactId: string | null
  tieneAgenda: boolean | null // null = sin contacto vinculado, no se puede verificar
  tieneVenta: boolean | null
  enlaceAgendaEnTexto: boolean
  messageCount: number
  respondido?: boolean // el equipo contestó tras el último mensaje del lead (embudo de DM)
}

export type ResumenMetricas = {
  totalConversaciones: number
  conContactoVinculado: number
  conAgendaVerificada: number
  conVentaVerificada: number
  sinContactoVinculado: number
  sinContactoConEnlaceAgenda: number // señal débil, nunca contada como agenda real
  tasaVinculacion: number // 0-1
  tasaAgendaSobreVinculados: number // 0-1, solo entre los que sí se pudieron verificar
  // Embudo de DM (petición de Alex, 1-oct): respuesta del equipo (al menos un mensaje propio
  // tras el último del lead) y enlace de agenda enviado por el equipo (señal de intención,
  // declarada como tal, nunca contada como cita real).
  respondidas: number
  conEnlaceAgenda: number
}

// Agregación COMPARTIDA (Instagram y GHL): una sola implementación del resumen para que las
// tarjetas cross-plataforma comparen lo mismo. Recibe el por-conversación ya resuelto y el total.
export function resumir(porConversacion: MetricaConversacion[], total: number): ResumenMetricas {
  const conContactoVinculado = porConversacion.filter((m) => m.matchedContactId).length
  const conAgendaVerificada = porConversacion.filter((m) => m.tieneAgenda === true).length
  const conVentaVerificada = porConversacion.filter((m) => m.tieneVenta === true).length
  const sinContacto = porConversacion.filter((m) => !m.matchedContactId)

  return {
    totalConversaciones: total,
    conContactoVinculado,
    conAgendaVerificada,
    conVentaVerificada,
    sinContactoVinculado: sinContacto.length,
    sinContactoConEnlaceAgenda: sinContacto.filter((m) => m.enlaceAgendaEnTexto).length,
    tasaVinculacion: total > 0 ? conContactoVinculado / total : 0,
    tasaAgendaSobreVinculados: conContactoVinculado > 0 ? conAgendaVerificada / conContactoVinculado : 0,
    respondidas: porConversacion.filter((m) => m.respondido).length,
    conEnlaceAgenda: porConversacion.filter((m) => m.enlaceAgendaEnTexto).length,
  }
}

export function calcularMetricas(
  conversations: IgConversation[],
  contactos: ContactoIg[],
  contactIdsConAgenda: Set<string>,
  contactIdsConVenta: Set<string>
): { resumen: ResumenMetricas; porConversacion: MetricaConversacion[] } {
  const emparejadas = emparejarConConTactos(conversations, contactos)
  const porConversacion: MetricaConversacion[] = conversations.map((conv) => {
    const matchedContactId = emparejadas.get(conv.id) ?? null
    return {
      conversationId: conv.id,
      participant: conv.participant,
      matchedContactId,
      tieneAgenda: matchedContactId ? contactIdsConAgenda.has(matchedContactId) : null,
      tieneVenta: matchedContactId ? contactIdsConVenta.has(matchedContactId) : null,
      enlaceAgendaEnTexto: detectarEnlaceAgendaEnTexto(conv),
      messageCount: conv.message_count,
      respondido: respondidoDespuesDelLead(conv.messages),
    }
  })

  return { resumen: resumir(porConversacion, conversations.length), porConversacion }
}
