import type { AppointmentStatus } from '@/lib/types/database'

// Statuses que cuentan como "asistió"/"no asistió" a la cita. Fuente única de verdad para no
// repetir el mismo literal `status === 'show' || status === 'completed'` en cada página de métricas.
export const ATTENDED_STATUSES = ['show', 'completed'] as const
export const NO_SHOW_STATUSES = ['no_show'] as const

export function isAttended(status: string | null | undefined) {
  return !!status && (ATTENDED_STATUSES as readonly string[]).includes(status)
}

export function isNoShow(status: string | null | undefined) {
  return !!status && (NO_SHOW_STATUSES as readonly string[]).includes(status)
}

// Labels/colores por status real (usado en el <Select> de edición de estado).
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Programada',
  confirmed: 'Confirmada',
  show: 'Se presento',
  no_show: 'No Show',
  cancelled: 'Cancelada',
  rescheduled: 'Reagendada',
  completed: 'Completada',
  cancelled_admin: 'Cancelada (Admin)',
  cancelled_lead: 'Cancelada (Lead)',
  seguimiento: 'Seguimiento',
  reserva: 'Reserva',
}

export const STATUS_COLORS: Record<AppointmentStatus, string> = {
  scheduled: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  // Verde queda reservado a "venta cerrada" (categoría compra); confirmada usa cian para no confundirse.
  confirmed: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  show: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  no_show: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/20 text-muted-foreground border-border/30',
  rescheduled: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  completed: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
  cancelled_admin: 'bg-zinc-500/20 text-muted-foreground border-border/30',
  cancelled_lead: 'bg-zinc-500/20 text-muted-foreground border-border/30',
  seguimiento: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  // Alineado con la categoría visual "Reserva" del semáforo (naranja).
  reserva: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

// Categoría visual de "semáforo" pedida por el equipo comercial: colores fijos que
// resumen el status real + si ya hay venta ligada. Se usa en el calendario y en la
// columna Estado de la tabla; el <Select> de edición sigue usando el status real.
// OJO: "reserva" es un status de negocio propio (el lead pagó la reserva/depósito),
// DISTINTO de estar simplemente agendado. Una cita scheduled/confirmed/rescheduled que
// todavía no se ha resuelto es "programada" (falta por hacerse). El status "seguimiento"
// también tiene su propio color (igual que el flag needs_followup), en vez de caer en programada.
export type AppointmentDisplayCategory = 'compra' | 'reserva' | 'programada' | 'seguimiento' | 'se_presenta' | 'no_show' | 'cancelada'

const CANCELLED_STATUSES: AppointmentStatus[] = ['cancelled', 'cancelled_admin', 'cancelled_lead']

export function getAppointmentCategory(status: AppointmentStatus, purchased: boolean): AppointmentDisplayCategory {
  if (purchased) return 'compra'
  if (CANCELLED_STATUSES.includes(status)) return 'cancelada'
  if (status === 'no_show') return 'no_show'
  if (isAttended(status)) return 'se_presenta'
  if (status === 'reserva') return 'reserva'
  if (status === 'seguimiento') return 'seguimiento'
  return 'programada'
}

export const CATEGORY_LABELS: Record<AppointmentDisplayCategory, string> = {
  compra: 'Comprado',
  reserva: 'Reserva',
  programada: 'Programada',
  seguimiento: 'Seguimiento',
  se_presenta: 'Se presentó',
  no_show: 'No Show',
  cancelada: 'Cancelada',
}

// Bloque del calendario (fondo grande).
export const CATEGORY_BLOCK_CLASSES: Record<AppointmentDisplayCategory, string> = {
  compra: 'bg-green-600/25 hover:bg-green-600/35 border-green-500/60',
  reserva: 'bg-orange-500/20 hover:bg-orange-500/30 border-orange-500/50',
  programada: 'bg-blue-500/20 hover:bg-blue-500/30 border-blue-500/50',
  seguimiento: 'bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-500/50',
  se_presenta: 'bg-yellow-500/20 hover:bg-yellow-500/30 border-yellow-500/50',
  no_show: 'bg-red-500/20 hover:bg-red-500/30 border-red-500/50',
  cancelada: 'bg-card/70 border-dashed border-border opacity-60 hover:opacity-100 line-through',
}

// Badge (tabla, panel de detalle, bloque del calendario).
export const CATEGORY_BADGE_CLASSES: Record<AppointmentDisplayCategory, string> = {
  compra: 'bg-green-600 text-white border-green-500',
  reserva: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  programada: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  seguimiento: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  se_presenta: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  no_show: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelada: 'bg-zinc-500/20 text-muted-foreground border-border/30 line-through',
}
