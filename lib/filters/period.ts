// Filtro de periodo reutilizable para todos los dashboards.
// Día / Semana / Mes / Trimestre / Año / Personalizado, + helpers de rango y CSV.

export type PeriodPreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  // Ventanas móviles: terminan HOY y cuentan hacia atrás. No son lo mismo que 'month' o 'year',
  // que son el mes/año natural: el día 2 de mes, 'month' son dos días y '30d' son treinta.
  | '3d'
  | '7d'
  | '30d'
  | '90d'
  // Del 1 de enero a HOY. Distinto de 'year', que llega al 31 de diciembre: con 'year', el rango
  // incluye meses que todavía no han pasado, y el "periodo anterior" comparativo se calcula sobre
  // una duración de 365 días en vez de sobre lo transcurrido.
  | 'ytd'
  | 'launch'
  | 'custom'

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'Todo el periodo',
  today: 'Hoy',
  yesterday: 'Ayer',
  day: 'Día concreto',
  week: 'Esta semana',
  month: 'Este mes',
  quarter: 'Este trimestre',
  year: 'Este año',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  ytd: 'Lo que va de año',
  launch: 'Desde el lanzamiento',
  custom: 'Personalizado',
}

/** Los presets que el brief pide como mínimo en Métricas y Campañas, en orden de menor a mayor. */
export const PERIOD_PRESETS_DASHBOARD: PeriodPreset[] = ['7d', '30d', '90d', 'ytd', 'launch', 'custom']

/**
 * El juego ESTÁNDAR: el que debe ofrecer cualquier pantalla con métricas, para que el mismo filtro
 * signifique lo mismo en todas. Antes siete pantallas llevaban su propia copia del tipo, de las
 * etiquetas y del cálculo — idénticas entre sí, pero sin ventanas móviles y condenadas a divergir en
 * cuanto alguien tocara una.
 */
export const PERIOD_PRESETS_BAR: PeriodPreset[] = [
  'today',
  'yesterday',
  '3d',
  'week',
  '7d',
  'month',
  '30d',
  'quarter',
  'year',
  'all',
  'custom',
  // Compatibilidad con enlaces y pantallas que todavía exponen estos presets.
  'day',
  '90d',
  'ytd',
  'launch',
]

export const PERIOD_PRESETS_STANDARD: PeriodPreset[] = [
  'all',
  'today',
  '3d',
  '7d',
  '30d',
  'month',
  'quarter',
  'year',
  'custom',
]

export type PeriodRange = { from: Date | null; to: Date | null }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

// Los inputs date entregan YYYY-MM-DD. Construir la fecha por partes evita que
// JavaScript la interprete como UTC y desplace el día según la zona horaria.
function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function toDateInputValue(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isDateRangeInvalid(from: string, to: string): boolean {
  const fromDate = parseDateInput(from)
  const toDate = parseDateInput(to)
  return !!fromDate && !!toDate && fromDate > toDate
}

export function getCustomDateRange(fromValue: string, toValue: string): PeriodRange {
  const parsedFrom = parseDateInput(fromValue)
  const parsedTo = parseDateInput(toValue)
  const from = parsedFrom ? startOfDay(parsedFrom) : null
  const to = parsedTo ? endOfDay(parsedTo) : null
  if (from && to && from > to) {
    return { from: startOfDay(parsedTo!), to: endOfDay(parsedFrom!) }
  }
  return { from, to }
}

/**
 * `launchDate` es la fecha desde la que esta subcuenta tiene datos. Se pasa desde la pantalla porque
 * depende de la fuente (Meta empieza antes que Stripe, Stripe antes que Fathom). Si no se conoce,
 * 'launch' se queda sin límite inferior: mostrar todo lo disponible es honesto; inventarse una fecha
 * de arranque no lo sería.
 */
export type PeriodOptions = { launchDate?: Date | string | null }

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  const parsed = parseDateInput(value) ?? new Date(value)
  return isNaN(parsed.getTime()) ? null : parsed
}

// Ventana móvil de N días que TERMINA hoy. Incluye hoy, así que '7d' son hoy y los seis anteriores:
// contar 7 días hacia atrás Y además hoy daría ocho días de datos bajo una etiqueta que dice siete.
function rollingWindow(now: Date, days: number): PeriodRange {
  const from = new Date(now)
  from.setDate(now.getDate() - (days - 1))
  return { from: startOfDay(from), to: endOfDay(now) }
}

export function getPeriodRange(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
  opts: PeriodOptions = {}
): PeriodRange {
  const now = new Date()
  switch (preset) {
    case '3d':
      return rollingWindow(now, 3)
    case '7d':
      return rollingWindow(now, 7)
    case '30d':
      return rollingWindow(now, 30)
    case '90d':
      return rollingWindow(now, 90)
    case 'ytd':
      return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: endOfDay(now) }
    case 'launch': {
      const desde = asDate(opts.launchDate)
      return { from: desde ? startOfDay(desde) : null, to: endOfDay(now) }
    }
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'yesterday': {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) }
    }
    case 'day': {
      // Un día concreto elegido en el selector (usa customFrom como la fecha).
      const d = parseDateInput(customFrom)
      if (!d) return { from: null, to: null }
      return { from: startOfDay(d), to: endOfDay(d) }
    }
    case 'week': {
      const day = now.getDay() === 0 ? 7 : now.getDay() // lunes = inicio de semana
      const monday = new Date(now)
      monday.setDate(now.getDate() - day + 1)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: startOfDay(monday), to: endOfDay(sunday) }
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3)
      const from = new Date(now.getFullYear(), q * 3, 1)
      const to = new Date(now.getFullYear(), q * 3 + 3, 0)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1)
      const to = new Date(now.getFullYear(), 11, 31)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'custom': {
      return getCustomDateRange(customFrom, customTo)
    }
    default:
      return { from: null, to: null }
  }
}

// Rango del periodo INMEDIATAMENTE ANTERIOR, de la misma duración, para comparativas
// "vs mes/día pasado". Si el rango actual no tiene límites (preset 'all' o custom sin fechas),
// no hay "anterior" que comparar.
export function getPreviousPeriodRange(range: PeriodRange): PeriodRange {
  if (!range.from || !range.to) return { from: null, to: null }
  const durationMs = range.to.getTime() - range.from.getTime()
  const prevTo = new Date(range.from.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - durationMs)
  return { from: prevFrom, to: prevTo }
}

// ¿La fecha cae dentro del rango? (null = sin límite por ese lado). Fechas nulas → false.
export function inPeriod(date: string | Date | null | undefined, range: PeriodRange): boolean {
  if (range.from == null && range.to == null) return true
  if (!date) return false
  const d = typeof date === 'string' ? (parseDateInput(date) ?? new Date(date)) : date
  if (isNaN(d.getTime())) return false
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

// Etiqueta corta para nombres de fichero de export
export function periodFileTag(preset: PeriodPreset, customFrom: string, customTo: string): string {
  if (preset === 'all') return 'todas'
  if (preset === 'launch') return 'desde_lanzamiento'
  if (preset === 'day') return customFrom || 'dia'
  if (preset === 'custom') return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
  return preset
}

// ---- CSV ----
export function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvEscape(c)).join(','))
  const csv = '﻿' + lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
