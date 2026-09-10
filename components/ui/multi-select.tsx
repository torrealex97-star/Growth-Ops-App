"use client"

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type MultiSelectOption = { value: string; label: string }

interface MultiSelectProps {
  options: MultiSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  // Texto cuando no hay nada seleccionado (equivale a "todas").
  allLabel?: string
  className?: string
  searchPlaceholder?: string
}

// Selector múltiple (checkbox) tipo Facebook: elige varias opciones y ve el conjunto.
// value = [] significa "todas". Pensado para filtrar por varias campañas a la vez.
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Seleccionar…',
  allLabel = 'Todas',
  className,
  searchPlaceholder = 'Buscar…',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  const label =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? '1 seleccionada'
        : `${value.length} seleccionadas`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center justify-between gap-2 text-sm rounded-lg border border-border bg-muted px-3 py-2 text-foreground hover:border-border focus:outline-none focus:border-brand-500 min-w-[13rem]',
            className
          )}
        >
          <span className="truncate">{label}</span>
          <div className="flex items-center gap-1 shrink-0">
            {value.length > 0 && (
              <X
                className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); onChange([]) }}
              />
            )}
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0 bg-card border-border text-foreground">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
          <button type="button" className="hover:text-foreground" onClick={() => onChange(filtered.map((o) => o.value))}>
            Seleccionar todo
          </button>
          <button type="button" className="hover:text-foreground" onClick={() => onChange([])}>
            Limpiar
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Sin resultados</p>
          ) : (
            filtered.map((o) => {
              const active = value.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded border shrink-0',
                      active ? 'bg-brand-600 border-brand-600' : 'border-border'
                    )}
                  >
                    {active && <Check className="w-3 h-3 text-foreground" />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
