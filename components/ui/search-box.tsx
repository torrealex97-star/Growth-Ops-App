'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

// La lógica pura vive en lib/utils.ts (cargable por node en tests); aquí solo la re-exportamos
// por compatibilidad con los consumidores existentes.
import { normalizeText, phoneMatches } from '@/lib/utils'
export { normalizeText, phoneMatches }

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

// normalizeText y phoneMatches viven en lib/utils.ts (fuente única, cargable por node en tests)
// y se re-exportan arriba por compatibilidad con los consumidores existentes.
