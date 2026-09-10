"use client"

import { useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface CalendarPopoverProps {
  /** Fecha seleccionada en formato YYYY-MM-DD, o null si no hay ninguna. */
  value: string | null
  /** Se llama con la nueva fecha en formato YYYY-MM-DD. */
  onChange: (date: string) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function toDateKey(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export function CalendarPopover({
  value,
  onChange,
  label,
  placeholder = 'Elige un día',
  disabled,
  className,
}: CalendarPopoverProps) {
  const selectedDate = value ? parseISO(value) : null
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState<Date>(selectedDate ?? new Date())

  const today = startOfDay(new Date())
  const monthStart = startOfMonth(viewMonth)
  const monthEnd = endOfMonth(viewMonth)
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // getDay: 0=domingo..6=sábado → convertimos a semana empezando en lunes (0=lunes..6=domingo)
  const leadingBlanks = (getDay(monthStart) + 6) % 7

  const handlePick = (day: Date) => {
    if (isBefore(day, today)) return
    onChange(toDateKey(day))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal bg-muted border-border text-foreground hover:bg-muted/80',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="w-4 h-4 mr-2 text-brand-400" />
          {value ? format(parseISO(value), "d 'de' MMMM 'de' yyyy", { locale: es }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 bg-card border-border">
        {label && <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>}
        <div className="flex items-center justify-between mb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setViewMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <p className="text-sm font-medium text-foreground capitalize">
            {format(viewMonth, 'MMMM yyyy', { locale: es })}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-center text-[10px] text-muted-foreground font-medium py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {daysInMonth.map((day) => {
            const isPast = isBefore(day, today)
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false
            const isToday = isSameDay(day, today)
            const inMonth = isSameMonth(day, viewMonth)
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={isPast || !inMonth}
                onClick={() => handlePick(day)}
                className={cn(
                  'aspect-square rounded-md text-sm flex items-center justify-center transition',
                  isPast || !inMonth
                    ? 'text-muted-foreground/40 cursor-not-allowed'
                    : 'text-foreground hover:bg-brand-500/20 hover:text-brand-300 cursor-pointer',
                  isSelected && 'bg-brand-600 text-white hover:bg-brand-500 hover:text-white',
                  isToday && !isSelected && 'border border-brand-500/50'
                )}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
