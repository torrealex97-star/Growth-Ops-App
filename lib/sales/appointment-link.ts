import type { SupabaseClient } from '@supabase/supabase-js'

type AppointmentCandidate = {
  id: string
  status: string | null
  appointment_datetime: string
}

/**
 * Resuelve la agenda que originó una venta sin adivinar.
 *
 * Prioridad:
 * 1. un único show/attended del mismo contacto en los 90 días anteriores;
 * 2. si no hay shows, una única agenda candidata;
 * 3. cualquier pluralidad ambigua queda sin enlazar para revisión humana.
 */
export function chooseSaleAppointment(candidates: AppointmentCandidate[]): string | null {
  const attended = candidates.filter((row) => row.status === 'show' || row.status === 'attended')
  if (attended.length === 1) return attended[0].id
  if (attended.length > 1) return null
  return candidates.length === 1 ? candidates[0].id : null
}

export async function resolveSaleAppointment(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  saleDate: string
): Promise<string | null> {
  const start = new Date(`${saleDate}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - 90)
  const end = new Date(`${saleDate}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)

  const { data, error } = await sb
    .from('appointments')
    .select('id,status,appointment_datetime')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .gte('appointment_datetime', start.toISOString())
    .lt('appointment_datetime', end.toISOString())
    .order('appointment_datetime', { ascending: false })

  if (error) throw new Error(`No se pudo resolver la agenda de la venta: ${error.message}`)
  return chooseSaleAppointment((data ?? []) as AppointmentCandidate[])
}
