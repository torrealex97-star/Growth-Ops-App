// Métricas de la tarjeta GHL del resumen cross-plataforma de Conversaciones (Setting AI).
//
// Principio idéntico al de Instagram (lib/instagram/conversation-metrics.ts): una conversación
// cuenta como "agenda/venta verificada" SOLO cuando está enlazada a un contacto real con cita/venta
// en BD — un hecho, no una suposición leída del texto. El enlace de agenda en el texto es señal
// débil y se separa, nunca se cuenta como agenda.
//
// La vinculación NO se lee del snapshot a ciegas: el snapshot la guardó en su momento, pero el
// matcher canónico puede haber cambiado desde entonces (contacto creado después, email añadido).
// Re-resolver con `vincularConContactos` da exactamente lo que la pestaña mostrará al refrescar.
// Las lecturas de citas/ventas son FAIL-LOUD: un error de BD invalida la tarjeta (500), no la pinta
// en cero — "un hueco no es un cero".
import type { SupabaseClient } from '@supabase/supabase-js'
import { leerSnapshotGhl, vincularConContactos } from '@/lib/ghl/conversaciones'
import {
  detectarEnlaceAgendaEnMensajes,
  respondidoDespuesDelLead,
  resumir,
  type MetricaConversacion,
  type ResumenMetricas,
} from '@/lib/instagram/conversation-metrics'

export async function calcularMetricasGhl(
  sb: SupabaseClient,
  tenantId: string
): Promise<{ resumen: ResumenMetricas; porConversacion: MetricaConversacion[]; guardado: string } | null> {
  const snap = await leerSnapshotGhl(tenantId)
  if (!snap || snap.conversaciones.length === 0) return null

  const conversaciones = await vincularConContactos(sb, tenantId, snap.conversaciones)

  const contactIds = [...new Set(conversaciones.map((c) => c.contactoVinculado?.id).filter((v): v is string => !!v))]
  const [{ data: citas, error: citasErr }, { data: ventas, error: ventasErr }] = await Promise.all([
    contactIds.length
      ? sb.from('appointments').select('contact_id').eq('tenant_id', tenantId).in('contact_id', contactIds)
      : Promise.resolve({ data: [] as { contact_id: string }[], error: null }),
    contactIds.length
      ? sb.from('sales').select('contact_id').eq('tenant_id', tenantId).in('contact_id', contactIds)
      : Promise.resolve({ data: [] as { contact_id: string }[], error: null }),
  ])
  if (citasErr) throw new Error(`No se pudieron leer las citas: ${citasErr.message}`)
  if (ventasErr) throw new Error(`No se pudieron leer las ventas: ${ventasErr.message}`)

  const agendaSet = new Set((citas || []).map((c) => c.contact_id))
  const ventaSet = new Set((ventas || []).map((v) => v.contact_id))

  const porConversacion: MetricaConversacion[] = conversaciones.map((c) => {
    const matchedContactId = c.contactoVinculado?.id ?? null
    return {
      conversationId: c.id,
      participant: c.contactoVinculado?.full_name || c.participant,
      matchedContactId,
      tieneAgenda: matchedContactId ? agendaSet.has(matchedContactId) : null,
      tieneVenta: matchedContactId ? ventaSet.has(matchedContactId) : null,
      enlaceAgendaEnTexto: detectarEnlaceAgendaEnMensajes(c.messages),
      messageCount: c.message_count,
      respondido: respondidoDespuesDelLead(c.messages),
    }
  })

  return { resumen: resumir(porConversacion, conversaciones.length), porConversacion, guardado: snap.guardado }
}
