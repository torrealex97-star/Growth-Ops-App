// Agregación de AGENDAS por persona — el complemento que el dashboard no tenía: por closer
// (la agenda apunta a quien la atiende/cierra), por setter y por colaborador (la agenda del
// contacto que el colaborador trajo, vía contact_attributions.collaborator_id).
//
// A DIFERENCIA de teamRanking/setterAgendaStats, aquí NO se filtra por rol: la agenda ya lleva
// a la persona asignada (webhooks vivos) y quien cierra puede tener rol admin (caso WDC: Claudia).
// Filtrar por rol aquí era lo que borraba del panel a quien realmente trabaja.
import { cuentaComoVenta, num } from '@/lib/analytics'
import { isAttended, isCancelled, isNoShow } from '@/lib/appointments/status'
import type { AppointmentRow, SaleRow } from '@/lib/analytics'

export type PersonaRow = {
  userId: string // closer/setter: users.id · colaborador: collaborator_profiles.id
  name: string
  total: number
  shows: number
  noShows: number
  /** Ni asistida ni no asistida ni cancelada: todavía no se sabe qué pasó. */
  sinResolver: number
  /**
   * % de asistencia sobre las citas RESUELTAS. `null` = ninguna resuelta, que no es un 0.
   *
   * Visto en producción el 25-sep: 68 agendas, 34 asistidas y CERO no-shows daban «50% show».
   * Los otros 34 no faltaron a nada — nadie los ha marcado. Es la misma regla que aplica la
   * definición canónica en `lib/metrics/agregados.ts`.
   */
  showRate: number | null
}

export function agendasPorPersona(
  appointments: AppointmentRow[],
  opts: {
    persona: 'closer' | 'setter' | 'collaborator'
    nameOf: Map<string, string>
    collaboratorOf: Map<string, string> // contact_id → collaborator_profiles.id
  }
): PersonaRow[] {
  const map = new Map<string, PersonaRow>()
  for (const a of appointments) {
    let id: string | null = null
    if (opts.persona === 'collaborator') {
      id = (a.contact_id && opts.collaboratorOf.get(a.contact_id)) || null
    } else {
      id = opts.persona === 'closer' ? a.closer_id : a.setter_id
    }
    if (!id) continue
    const row =
      map.get(id) ??
      map
        .set(id, {
          userId: id,
          name: opts.nameOf.get(id) || 'Sin asignar',
          total: 0,
          shows: 0,
          noShows: 0,
          sinResolver: 0,
          showRate: null,
        })
        .get(id)!
    row.total += 1
    // `isAttended`, no `status === 'show'`: 'completed' también es asistir.
    if (isAttended(a.status)) row.shows += 1
    else if (isNoShow(a.status)) row.noShows += 1
    else if (!isCancelled(a.status)) row.sinResolver += 1
  }
  map.forEach((r) => {
    const resueltas = r.shows + r.noShows
    r.showRate = resueltas > 0 ? (r.shows / resueltas) * 100 : null
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// VENTAS por colaborador: facturación activa y cobros de los contactos atribuidos a cada
// colaborador (misma cadena que attributionBySource, pero agrupada por persona).
export type ColabVentasRow = {
  userId: string // collaborator_profiles.id
  name: string
  sales: number
  gross: number
  cash: number
}

export function ventasPorColaborador(
  sales: SaleRow[],
  collections: { sale_id: string; gross_amount: number | string; status: string }[],
  opts: { nameOf: Map<string, string>; collaboratorOf: Map<string, string> }
): ColabVentasRow[] {
  const saleColab = new Map<string, string>() // sale_id → colaborador (vía contact_id)
  const agg = new Map<string, ColabVentasRow>()
  const ensure = (id: string) =>
    agg.get(id) ??
    agg.set(id, { userId: id, name: opts.nameOf.get(id) || 'Colaborador', sales: 0, gross: 0, cash: 0 }).get(id)!

  for (const s of sales) {
    if (!s.contact_id || !cuentaComoVenta(s)) continue
    const colab = opts.collaboratorOf.get(s.contact_id)
    if (!colab) continue
    saleColab.set(s.id, colab)
    const row = ensure(colab)
    row.sales += 1
    row.gross += num(s.gross_amount)
  }
  for (const c of collections) {
    if (c.status !== 'collected') continue
    const colab = saleColab.get(c.sale_id)
    if (!colab) continue
    ensure(colab).cash += num(c.gross_amount)
  }
  return Array.from(agg.values()).sort((a, b) => b.gross - a.gross)
}
