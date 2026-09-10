// Estados del lead (contacts.lead_status) — fuente única para la tabla de Leads y la ficha de
// contacto, que antes los declaraban por separado y se desincronizaban.
// El orden del array es el orden del embudo: así se usa tal cual en selectores y contadores.
export type LeadStatus =
  | 'registrado'
  | 'whatsapp_enviado'
  | 'llamado'
  | 'no_contesta'
  | 'en_seguimiento'
  | 'agendado'
  | 'reserva'
  | 'venta'
  | 'cliente'
  | 'descartado'

export const LEAD_STATUSES: { value: LeadStatus; label: string; color: string }[] = [
  { value: 'registrado', label: 'Registrado', color: 'bg-zinc-500/20 text-foreground border-border/30' },
  { value: 'whatsapp_enviado', label: 'WhatsApp enviado', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'llamado', label: 'Llamado', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'no_contesta', label: 'No contesta', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'en_seguimiento', label: 'En seguimiento', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  { value: 'agendado', label: 'Agendado', color: 'bg-brand-500/20 text-brand-400 border-brand-500/30' },
  { value: 'reserva', label: 'Reserva', color: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  { value: 'venta', label: 'Venta', color: 'bg-emerald-600/30 text-emerald-300 border-emerald-500/40' },
  { value: 'cliente', label: 'Cliente', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'descartado', label: 'Descartado', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
]

export const leadStatusMeta = (s: string) => LEAD_STATUSES.find((x) => x.value === s) ?? LEAD_STATUSES[0]
export const LEAD_STATUS_LABELS: Record<string, string> = Object.fromEntries(LEAD_STATUSES.map((s) => [s.value, s.label]))
export const LEAD_STATUS_COLORS: Record<string, string> = Object.fromEntries(LEAD_STATUSES.map((s) => [s.value, s.color]))

// Estados que implican que ya hubo contacto real con el lead (para el ratio de contactados).
export const CONTACTED_LEAD_STATUSES: LeadStatus[] = [
  'whatsapp_enviado', 'llamado', 'en_seguimiento', 'agendado', 'reserva', 'venta', 'cliente',
]
