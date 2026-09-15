export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat('es-ES', { useGrouping: true, ...options }).format(n)
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
    useGrouping: true,
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
  return `${formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`
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

export function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}
