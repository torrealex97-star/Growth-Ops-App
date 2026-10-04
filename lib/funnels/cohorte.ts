// COHORTE DE LEADS DEL PERIODO: lo que el embudo de actividad NO puede decir.
//
// El embudo por actividad cuenta hechos del periodo (leads creados, citas celebradas, ventas) y por
// eso sus conversiones no son comparables: la venta de hoy puede ser de un lead de hace tres meses.
// La cohorte parte de las PERSONAS que entraron en el periodo y sigue qué ha pasado con ellas
// (enlazando por contacto), sin mirar cuándo ocurrió cada paso. Dos cautelas:
//   · Madurez: un lead de hace tres días no ha tenido tiempo de comprar. Una cohorte cuyo último lead
//     es más reciente que `DIAS_MADUREZ` se marca «en maduración» y sus tasas no se juzgan.
//   · Sin atribuir: los leads sin campaña se cuentan aparte; no se reparten entre canales.
// Es puro: no sabe nada de Supabase.

import { cuentaComoVenta, leadDate } from '@/lib/analytics'
import { isAttended } from '@/lib/appointments/status'
import { canonicalizeLeads } from '@/lib/canonical/dedup'
import { isCancelled } from '@/lib/unit-economics'

export const DIAS_MADUREZ = 30
const DIA_MS = 86_400_000

type Contacto = {
  id: string
  email?: string | null
  phone?: string | null
  created_at?: string | null
  first_seen_at?: string | null
  campaign_id?: string | null
}
type Cita = { contact_id: string | null; status: string; appointment_datetime: string | null }
type Venta = Parameters<typeof cuentaComoVenta>[0] & { contact_id: string | null }

export type Cohorte = {
  leads: number
  conAgenda: number
  conAsistencia: number
  conVenta: number
  /** Leads de la cohorte sin campaña atribuida. */
  sinAtribuir: number
  /** true si el último lead del periodo aún no ha tenido `DIAS_MADUREZ` días para convertir. */
  enMaduracion: boolean
}

export function cohorteDeLeads(
  contactos: Contacto[],
  citas: Cita[],
  ventas: Venta[],
  rango: { from: Date | null; to: Date | null },
  ahora: Date = new Date()
): Cohorte {
  const { leads } = canonicalizeLeads(
    contactos.map((c) => ({
      ...c,
      email: c.email ?? null,
      phone: c.phone ?? null,
      created_at: leadDate(c) || null,
    }))
  )
  const delPeriodo = leads.filter((l) => {
    if (!l.createdAt) return false
    const t = Date.parse(l.createdAt)
    return !Number.isNaN(t) && (!rango.from || t >= rango.from.getTime()) && (!rango.to || t <= rango.to.getTime())
  })

  const idsCon = (filas: { contact_id: string | null }[]) =>
    new Set(filas.map((f) => f.contact_id).filter((x): x is string => !!x))
  const conAgenda = idsCon(citas.filter((c) => !isCancelled(c.status)))
  const conAsistencia = idsCon(
    citas.filter(
      (c) => isAttended(c.status) && (!c.appointment_datetime || Date.parse(c.appointment_datetime) <= ahora.getTime())
    )
  )
  const conVenta = idsCon(ventas.filter((v) => cuentaComoVenta(v)))

  const alguno = (ids: Set<string>, l: (typeof leads)[number]) => l.members.some((m) => ids.has(m.id))
  const ultimo = delPeriodo.reduce((max, l) => Math.max(max, Date.parse(l.createdAt as string)), 0)
  return {
    leads: delPeriodo.length,
    conAgenda: delPeriodo.filter((l) => alguno(conAgenda, l)).length,
    conAsistencia: delPeriodo.filter((l) => alguno(conAsistencia, l)).length,
    conVenta: delPeriodo.filter((l) => alguno(conVenta, l)).length,
    sinAtribuir: delPeriodo.filter((l) => !l.members.some((m) => (m as Contacto).campaign_id)).length,
    enMaduracion: delPeriodo.length > 0 && ahora.getTime() - ultimo < DIAS_MADUREZ * DIA_MS,
  }
}
