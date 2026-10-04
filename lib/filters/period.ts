// Filtro de periodo reutilizable para todos los dashboards.
// Día / Semana / Mes / Trimestre / Año / Personalizado, + helpers de rango y CSV.

import { addDaysYmd, businessEndOfDay, businessStartOfDay, businessToday, parseYmd } from '@/lib/dates/business'

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

/** Default global: TODAS las vistas abren en 'Este mes'. Si una vista tiene una razón funcional
 * muy fuerte para otro default, documentarla aquí antes de cambiarla. */
export const DEFAULT_PERIOD: PeriodPreset = 'month'

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

// TODAS LAS FRONTERAS SON LAS DEL NEGOCIO (Europe/Madrid), no las del navegador ni las del servidor.
// Con la zona local, quien abre el panel desde otra zona (o un render en UTC) veía «hoy», «esta
// semana» o «este mes» desplazados horas respecto a lo que la empresa llama hoy. Los rangos se
// construyen sobre fechas del calendario (YYYY-MM-DD) y solo al final pasan a instantes.
const startOfDay = (ymd: string) => businessStartOfDay(ymd) as Date
const endOfDay = (ymd: string) => businessEndOfDay(ymd) as Date

function ymdParts(ymd: string) {
  return parseYmd(ymd) as { y: number; m: number; d: number }
}
const ymdOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)

// Los inputs date entregan YYYY-MM-DD. Se validan como día real del calendario.
function parseDateInput(value: string): string | null {
  return parseYmd(value) ? value : null
}

/** Fecha YYYY-MM-DD del instante dado, en la zona del negocio. */
export function toDateInputValue(date = new Date()): string {
  return businessToday(date)
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

// Fecha del calendario (YYYY-MM-DD, zona del negocio) de lo que llegue como fecha de arranque.
function asYmd(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : businessToday(value)
  if (parseYmd(value)) return value
  const parsed = new Date(value)
  return isNaN(parsed.getTime()) ? null : businessToday(parsed)
}

// Ventana móvil de N días que TERMINA hoy. Incluye hoy, así que '7d' son hoy y los seis anteriores:
// contar 7 días hacia atrás Y además hoy daría ocho días de datos bajo una etiqueta que dice siete.
function rollingWindow(today: string, days: number): PeriodRange {
  return { from: startOfDay(addDaysYmd(today, -(days - 1))), to: endOfDay(today) }
}

export function getPeriodRange(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
  opts: PeriodOptions = {},
  now: Date = new Date()
): PeriodRange {
  const today = businessToday(now)
  const { y, m } = ymdParts(today)
  switch (preset) {
    case '3d':
      return rollingWindow(today, 3)
    case '7d':
      return rollingWindow(today, 7)
    case '30d':
      return rollingWindow(today, 30)
    case '90d':
      return rollingWindow(today, 90)
    case 'ytd':
      return { from: startOfDay(ymdOf(y, 1, 1)), to: endOfDay(today) }
    case 'launch': {
      const desde = asYmd(opts.launchDate)
      return { from: desde ? startOfDay(desde) : null, to: endOfDay(today) }
    }
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) }
    case 'yesterday': {
      const yesterday = addDaysYmd(today, -1)
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) }
    }
    case 'day': {
      // Un día concreto elegido en el selector (usa customFrom como la fecha).
      const d = parseDateInput(customFrom)
      if (!d) return { from: null, to: null }
      return { from: startOfDay(d), to: endOfDay(d) }
    }
    case 'week': {
      // lunes = inicio de semana. Día de la semana del calendario (0 = domingo).
      const dow = new Date(Date.UTC(y, m - 1, ymdParts(today).d)).getUTCDay()
      const monday = addDaysYmd(today, -((dow === 0 ? 7 : dow) - 1))
      return { from: startOfDay(monday), to: endOfDay(addDaysYmd(monday, 6)) }
    }
    case 'month':
      return { from: startOfDay(ymdOf(y, m, 1)), to: endOfDay(ymdOf(y, m + 1, 0)) }
    case 'quarter': {
      const q = Math.floor((m - 1) / 3)
      return { from: startOfDay(ymdOf(y, q * 3 + 1, 1)), to: endOfDay(ymdOf(y, q * 3 + 4, 0)) }
    }
    case 'year':
      return { from: startOfDay(ymdOf(y, 1, 1)), to: endOfDay(ymdOf(y, 12, 31)) }
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
  // Una fecha sin hora (columna DATE) es ese día en la zona del negocio, no un instante UTC.
  const d = typeof date === 'string' ? (businessStartOfDay(date) ?? new Date(date)) : date
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
function csvEscape(value: string | number | null | undefined): string {
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
