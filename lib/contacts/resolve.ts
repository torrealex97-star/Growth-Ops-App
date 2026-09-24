import type { SupabaseClient } from '@supabase/supabase-js'

// Resolver-o-crear contacto. Toda la lógica vive en la función de base de datos
// `contacts_get_or_create` (ver supabase/migrations/20260914150000_contacts_get_or_create.sql):
// los webhooks hacían SELECT y luego INSERT en dos viajes, así que dos entregas concurrentes del
// mismo lead creaban dos contactos y partían su historial. La función serializa esa ventana con un
// advisory lock por clave de identidad, encaja por id de GHL → email → teléfono y sigue el puntero
// de fusión si la coincidencia ya se había unificado con otro contacto.

type ContactIdentity = {
  email?: string | null
  phone?: string | null
  ghlContactId?: string | null
  fullName?: string | null
  firstName?: string | null
  lastName?: string | null
  instagram?: string | null
  age?: number | null
  leadStatus?: string | null
  /**
   * Canal de origen de la entrega (p.ej. "formulario vsl - automaticamente", "calendly"). Solo se
   * estampa al CREAR el contacto (first-touch); si ya existía, se descarta. NULL = hueco de
   * captura honesto, lo cuenta Data Health — nunca se rellena con un valor inventado.
   */
  leadChannel?: string | null
  /** Momento de la entrega: se usa como first_seen_at/last_seen_at si hay que crear el contacto. */
  seenAt?: string
}

type ResolvedContact = {
  id: string
  full_name: string | null
  ghl_contact_id: string | null
}

type ResolveResult = { ok: true; contact: ResolvedContact; created: boolean } | { ok: false; error: string }

export async function getOrCreateContact(
  sb: SupabaseClient,
  tenantId: string,
  identity: ContactIdentity
): Promise<ResolveResult> {
  const { data, error } = await sb
    .rpc('contacts_get_or_create', {
      p_tenant_id: tenantId,
      p_email: identity.email ?? null,
      p_phone: identity.phone ?? null,
      p_ghl_contact_id: identity.ghlContactId ?? null,
      p_full_name: identity.fullName ?? null,
      p_first_name: identity.firstName ?? null,
      p_last_name: identity.lastName ?? null,
      p_instagram: identity.instagram ?? null,
      p_age: identity.age ?? null,
      p_lead_status: identity.leadStatus ?? null,
      p_seen_at: identity.seenAt ?? new Date().toISOString(),
      p_lead_channel: identity.leadChannel ?? null,
    })
    .select('id, full_name, ghl_contact_id, created')
    .maybeSingle<ResolvedContact & { created: boolean }>()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'contacts_get_or_create no devolvió ningún contacto' }
  return {
    ok: true,
    contact: { id: data.id, full_name: data.full_name, ghl_contact_id: data.ghl_contact_id },
    created: data.created,
  }
}
