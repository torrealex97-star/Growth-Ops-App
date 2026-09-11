"use client"

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

// Caja de búsqueda de texto reutilizable (icono + input) con el estilo del panel.
export function SearchBox({
  value,
  onChange,
  placeholder = 'Buscar...',
  className = 'w-72',
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        className="pl-9 pr-9 bg-card border-border [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          title="Limpiar búsqueda"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// Normaliza texto para búsquedas (minúsculas + sin acentos).
export function normalizeText(s: string): string {
  return s.toLocaleLowerCase('es-ES').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
}

// Compara un teléfono ignorando espacios, guiones y prefijo +.
export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  const qd = query.replace(/[^\d]/g, '')
  if (qd.length < 3) return false
  return (phone ?? '').replace(/[^\d]/g, '').includes(qd)
}
