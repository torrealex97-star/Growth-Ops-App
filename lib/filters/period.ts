// Filtro de periodo reutilizable para todos los dashboards.
// Día / Semana / Mes / Trimestre / Año / Personalizado, + helpers de rango y CSV.

export type PeriodPreset = 'all' | 'today' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'Todo',
  today: 'Hoy',
  day: 'Día concreto',
  week: 'Esta semana',
  month: 'Este mes',
  quarter: 'Este trimestre',
  year: 'Este año',
  custom: 'Rango personalizado',
}

export type PeriodRange = { from: Date | null; to: Date | null }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

// Los inputs date entregan YYYY-MM-DD. Construir la fecha por partes evita que
// JavaScript la interprete como UTC y desplace el día según la zona horaria.
export function parseDateInput(value: string): Date | null {
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

export function getPeriodRange(preset: PeriodPreset, customFrom: string, customTo: string): PeriodRange {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
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
  const d = typeof date === 'string'
    ? (parseDateInput(date) ?? new Date(date))
    : date
  if (isNaN(d.getTime())) return false
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

// Etiqueta corta para nombres de fichero de export
export function periodFileTag(preset: PeriodPreset, customFrom: string, customTo: string): string {
  if (preset === 'all') return 'todas'
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
