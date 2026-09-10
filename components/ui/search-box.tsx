"use client"

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

// Caja de búsqueda de texto reutilizable (icono + input) con el estilo del panel.
export function SearchBox({
  value,
  onChange,
  placeholder = 'Buscar...',
  className = 'w-72',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 bg-card border-border"
      />
    </div>
  )
}

// Normaliza texto para búsquedas (minúsculas + sin acentos).
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
}

// Compara un teléfono ignorando espacios, guiones y prefijo +.
export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  const qd = query.replace(/[^\d]/g, '')
  if (qd.length < 3) return false
  return (phone ?? '').replace(/[^\d]/g, '').includes(qd)
}
