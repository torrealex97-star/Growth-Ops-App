// Filtrado de la bandeja de Conversaciones (Setting AI) — lógica pura, testeada sin React.
//
// El filtrado es EN CLIENTE: la lista ya está en memoria (pull de ≤20 conversaciones) y un
// roundtrip no aporta nada. Reutiliza la normalización canónica del SearchBox del panel
// (minúsculas + sin acentos; teléfonos comparados por dígitos con phoneMatches) — la misma que
// el CRM. Busca por nombre (perfil vinculado, participante o contacto GHL), email y teléfono.
import { normalizeText, phoneMatches } from '@/lib/utils'

export type ConversacionFiltrable = {
  id: string
  participant?: string
  channel?: string
  contactId?: string
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contactoVinculado?: { id: string; full_name: string } | null
}

export function filtrarConversaciones<T extends ConversacionFiltrable>(
  convs: T[],
  busqueda: string,
  canal: string
): T[] {
  const q = normalizeText(busqueda.trim())
  return convs.filter((c) => {
    if (canal !== 'todos' && (c.channel || 'chat') !== canal) return false
    if (!q) return true
    if (phoneMatches(c.contact_phone, q)) return true
    return [c.contactoVinculado?.full_name, c.participant, c.contact_name, c.contact_email].some(
      (v) => !!v && normalizeText(v).includes(q)
    )
  })
}

// Canales presentes en los datos (derivados, no un menú fijo: solo se ofrece filtrar por lo que
// existe — en Instagram habrá uno solo y el select no se muestra).
export function canalesDisponibles(convs: { channel?: string }[]): string[] {
  return [...new Set(convs.map((c) => c.channel || 'chat'))].sort()
}
