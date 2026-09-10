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

export function getPeriodRange(preset: PeriodPreset, customFrom: string, customTo: string): PeriodRange {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'day': {
      // Un día concreto elegido en el selector (usa customFrom como la fecha).
      if (!customFrom) return { from: null, to: null }
      const d = new Date(customFrom)
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
      const from = customFrom ? startOfDay(new Date(customFrom)) : null
      const to = customTo ? endOfDay(new Date(customTo)) : null
      return { from, to }
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
  const d = typeof date === 'string' ? new Date(date) : date
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
