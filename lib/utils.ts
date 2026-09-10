export function formatNumber(n: number): string {
  return n.toLocaleString('es-ES')
}

// --- shadcn/ui utilities ---
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

// `.toFixed()` siempre usa punto decimal (es-en), mezclando con el resto de la app que
// usa coma decimal europea (formatCurrency/formatNumber) — de ahí "12.5%" junto a "1.234,56 €".
export function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value)}%`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Genera un slug alfanumérico (sin guiones, sin acentos) para usar como
// tracking_code / affiliate_code, ej: "Alex Torre" -> "alextorre"
export function slugifyTrackingCode(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    let d: Date | null = null

    // Try DD/MM/YYYY HH:MM or DD/MM/YYYY
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
    if (ddmmyyyy) {
      d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`)
    } else {
      d = new Date(dateStr)
    }

    if (!d || isNaN(d.getTime())) return dateStr

    return d.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (score >= 40) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-red-500/20 text-red-400 border-red-500/30'
}

export function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}
