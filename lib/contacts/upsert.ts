import type { SupabaseClient } from '@supabase/supabase-js'

export const normalizeContactEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  return value.trim().toLowerCase() || null
}

export const normalizeContactPhone = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  return value.replace(/[^0-9]/g, '') || null
}

type ContactIdentity = {
  email?: unknown
  phone?: unknown
  ghl_contact_id?: unknown
}

function contactRow(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && 'id' in value ? (value as Record<string, unknown>) : null
}

async function findByIdentity(
  sb: SupabaseClient,
  tenantId: string,
  identity: ContactIdentity,
  select: string
): Promise<Record<string, unknown> | null> {
  const ghlContactId = typeof identity.ghl_contact_id === 'string' ? identity.ghl_contact_id.trim() : ''
  const email = normalizeContactEmail(identity.email)
  const phone = normalizeContactPhone(identity.phone)
  const lookups: Array<[string, string]> = []
  if (ghlContactId) lookups.push(['ghl_contact_id', ghlContactId])
  if (email) lookups.push(['email_normalized', email])
  if (phone) lookups.push(['phone_normalized', phone])
  for (const [column, value] of lookups) {
    const { data, error } = await sb
      .from('contacts')
      .select(select)
      .eq('tenant_id', tenantId)
      .eq(column, value)
      .maybeSingle()
    if (error) throw error
    const row = contactRow(data)
    if (row) return row
  }
  return null
}

export async function upsertContactByIdentity(
  sb: SupabaseClient,
  tenantId: string,
  values: Record<string, unknown>,
  select: string
): Promise<{ data: Record<string, unknown>; created: boolean }> {
  const canonical = {
    ...values,
    tenant_id: tenantId,
    email: normalizeContactEmail(values.email),
  }
  const existing = await findByIdentity(sb, tenantId, canonical, select)
  if (existing) return { data: existing, created: false }

  const inserted = await sb.from('contacts').insert(canonical).select(select).single()
  const insertedRow = contactRow(inserted.data)
  if (!inserted.error && insertedRow) return { data: insertedRow, created: true }
  if (inserted.error?.code !== '23505') throw inserted.error

  // Dos entregas concurrentes pueden superar la búsqueda inicial. La UNIQUE decide cuál gana;
  // la perdedora recupera y actualiza esa misma fila, de modo que ambas respuestas son idempotentes.
  const winner = await findByIdentity(sb, tenantId, canonical, select)
  if (!winner) throw inserted.error
  return { data: winner, created: false }
}
