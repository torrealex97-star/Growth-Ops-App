import type { SupabaseClient } from '@supabase/supabase-js'

// BÚSQUEDA DE CONTACTO POR CORREO, SIN CREAR.
//
// Vive fuera de `resolve.ts` a propósito: aquel módulo tiene el contrato de delegar SIEMPRE en la
// RPC atómica `contacts_get_or_create` y no tocar la tabla, porque resolver-o-crear en TypeScript
// reintroduce la carrera entre dos webhooks simultáneos (ver `tests/contactos-carrera.test.mjs`).
// Esto es otra cosa: una lectura pura que nunca crea nada, así que no comparte ese riesgo ni debe
// contaminar aquel invariante.

/**
 * Busca el contacto de una subcuenta por correo, SIN crearlo.
 *
 * Existe porque hay sitios donde aparece un correo que no justifica
 * dar de alta a nadie —por ejemplo, un asistente a una reunión de Fathom que el sync no supo
 * emparejar—. Ahí queremos el vínculo si la persona ya es contacto, y nada si no lo es: crear una
 * ficha por cada correo que pasa por delante ensucia el CRM y multiplica la PII que después hay que
 * poder borrar.
 *
 * Devuelve `null` cuando no hay correo, cuando nadie casa, o cuando casa más de uno: ante ambigüedad
 * se prefiere no vincular a vincular mal, porque un vínculo equivocado manda PII de una persona al
 * expediente de otra. Los contactos absorbidos por un merge (`merged_into`) se excluyen.
 */
export async function buscarContactoPorEmail(
  sb: SupabaseClient,
  tenantId: string,
  email: string | null | undefined
): Promise<string | null> {
  const normalizado = email?.trim().toLowerCase()
  if (!normalizado) return null
  const { data, error } = await sb
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email_normalized', normalizado)
    .is('merged_into', null)
    .limit(2)
  if (error || !data || data.length !== 1) return null
  return (data[0] as { id: string }).id
}
