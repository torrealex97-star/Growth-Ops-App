function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized =
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}@+.]/gu, '') ?? ''
  return normalized || null
}

export function countDuplicateValues(values: Array<string | null | undefined>): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const value of values) {
    const normalized = normalizeIdentity(value)
    if (!normalized) continue
    if (seen.has(normalized)) duplicates += 1
    else seen.add(normalized)
  }
  return duplicates
}

export function countDuplicateKeys(values: Array<string | null | undefined>): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const value of values) {
    if (!value) continue
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  }
  return duplicates
}

export type SourceHealthStatus = 'connected' | 'needs_attention' | 'not_configured'

export function deriveSourceStatus(configured: boolean, records: number): SourceHealthStatus {
  if (!configured) return 'not_configured'
  return records > 0 ? 'connected' : 'needs_attention'
}

export type DuplicateContact = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  created_at: string
}

export type DuplicateContactGroup = {
  key: string
  primaryId: string
  duplicateIds: string[]
  contacts: DuplicateContact[]
}

// Agrupa contactos con el mismo email o teléfono normalizado (ver normalizeIdentity). El más
// antiguo (primer created_at) se propone como primario — suele ser el que acumula más historial
// (ventas, agendas) al haberse creado antes.
export function findDuplicateContactGroups(contacts: DuplicateContact[]): DuplicateContactGroup[] {
  const byKey = new Map<string, DuplicateContact[]>()
  for (const c of contacts) {
    for (const key of [
      c.email && `email:${normalizeIdentity(c.email)}`,
      c.phone && `phone:${normalizeIdentity(c.phone)}`,
    ]) {
      if (!key) continue
      const arr = byKey.get(key) || []
      arr.push(c)
      byKey.set(key, arr)
    }
  }
  const seenGroupContacts = new Set<string>()
  const groups: DuplicateContactGroup[] = []
  for (const [key, group] of byKey.entries()) {
    if (group.length < 2) continue
    const sortedIds = [...group].sort((a, b) => a.id.localeCompare(b.id))
    const dedupeKey = sortedIds.map((c) => c.id).join(',')
    if (seenGroupContacts.has(dedupeKey)) continue
    seenGroupContacts.add(dedupeKey)
    const sorted = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    groups.push({
      key,
      primaryId: sorted[0].id,
      duplicateIds: sorted.slice(1).map((c) => c.id),
      contacts: sorted,
    })
  }
  return groups
}

export type DuplicateAppointment = {
  id: string
  external_source: string | null
  external_id: string | null
  appointment_datetime: string
  created_at: string
}

export type DuplicateAppointmentGroup = {
  key: string
  keepId: string
  duplicateIds: string[]
}

// Solo agrupa por (external_source, external_id) exactos — una reingesta del mismo webhook, no
// dos reuniones legítimas del mismo contacto (eso ya se reporta aparte como "revisar", nunca se
// fusiona automáticamente).
export function findDuplicateAppointmentGroups(appointments: DuplicateAppointment[]): DuplicateAppointmentGroup[] {
  const byKey = new Map<string, DuplicateAppointment[]>()
  for (const a of appointments) {
    if (!a.external_source || !a.external_id) continue
    const key = `${a.external_source}:${a.external_id}`
    const arr = byKey.get(key) || []
    arr.push(a)
    byKey.set(key, arr)
  }
  const groups: DuplicateAppointmentGroup[] = []
  for (const [key, group] of byKey.entries()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    groups.push({ key, keepId: sorted[0].id, duplicateIds: sorted.slice(1).map((a) => a.id) })
  }
  return groups
}
