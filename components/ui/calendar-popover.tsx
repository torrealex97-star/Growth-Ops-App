'use client'

import { useEffect, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isWithinInterval,
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
  disablePast?: boolean
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
  disablePast = true,
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
    if (disablePast && isBefore(day, today)) return
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
            const isPast = disablePast && isBefore(day, today)
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

interface DateRangeCalendarPopoverProps {
  from: string
  to: string
  onFromChange: (date: string) => void
  onToChange: (date: string) => void
  label?: string
  placeholder?: string
  min?: string
  max?: string
  className?: string
}

function calendarMonthDays(month: Date) {
  const first = startOfMonth(month)
  return {
    days: eachDayOfInterval({ start: first, end: endOfMonth(month) }),
    leadingBlanks: (getDay(first) + 6) % 7,
  }
}

/** Selector visual de rango, con el patrón habitual de reservas: inicio → fin y tramo resaltado. */
export function DateRangeCalendarPopover({
  from,
  to,
  onFromChange,
  onToChange,
  label = 'Rango de fechas',
  placeholder = 'Seleccionar fechas',
  min,
  max,
  className,
}: DateRangeCalendarPopoverProps) {
  const [open, setOpen] = useState(false)
  const fromDate = from ? startOfDay(parseISO(from)) : null
  const toDate = to ? startOfDay(parseISO(to)) : null
  const minDate = min ? startOfDay(parseISO(min)) : null
  const maxDate = max ? startOfDay(parseISO(max)) : null
  const [viewMonth, setViewMonth] = useState<Date>(fromDate ?? toDate ?? new Date())

  useEffect(() => {
    if (open && (from || to)) setViewMonth(startOfDay(parseISO(from || to)))
  }, [open, from, to])

  const pick = (day: Date) => {
    const key = toDateKey(day)
    if (!fromDate || toDate) {
      onFromChange(key)
      onToChange('')
      return
    }
    if (isBefore(day, fromDate)) {
      onFromChange(key)
      onToChange(from)
    } else {
      onToChange(key)
    }
    setOpen(false)
  }

  const labelText =
    fromDate && toDate
      ? `${format(fromDate, 'd MMM yyyy', { locale: es })} — ${format(toDate, 'd MMM yyyy', { locale: es })}`
      : fromDate
        ? `${format(fromDate, 'd MMM yyyy', { locale: es })} — elige fin`
        : placeholder

  const renderMonth = (month: Date, secondary = false) => {
    const { days, leadingBlanks } = calendarMonthDays(month)
    return (
      <div className={cn('min-w-0', secondary && 'hidden sm:block')}>
        <p className="mb-3 text-center text-sm font-medium capitalize text-foreground">
          {format(month, 'MMMM yyyy', { locale: es })}
        </p>
        <div className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((weekday) => (
            <div key={weekday} className="py-1 text-center text-[10px] font-medium text-muted-foreground">
              {weekday}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }).map((_, index) => (
            <div key={`blank-${index}`} />
          ))}
          {days.map((day) => {
            const unavailable = (!!minDate && isBefore(day, minDate)) || (!!maxDate && isAfter(day, maxDate))
            const isStart = !!fromDate && isSameDay(day, fromDate)
            const isEnd = !!toDate && isSameDay(day, toDate)
            const rangeStart = fromDate && toDate && isAfter(fromDate, toDate) ? toDate : fromDate
            const rangeEnd = fromDate && toDate && isAfter(fromDate, toDate) ? fromDate : toDate
            const inRange = !!rangeStart && !!rangeEnd && isWithinInterval(day, { start: rangeStart, end: rangeEnd })
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={unavailable}
                onClick={() => pick(day)}
                aria-label={format(day, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}
                aria-pressed={isStart || isEnd}
                className={cn(
                  'relative flex h-9 items-center justify-center text-sm text-foreground outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-400',
                  inRange && 'bg-brand-500/15',
                  isStart && 'rounded-l-md bg-brand-600 font-semibold text-white',
                  isStart && !toDate && 'rounded-md',
                  isEnd && 'rounded-r-md bg-brand-600 font-semibold text-white',
                  !unavailable && !isStart && !isEnd && 'hover:bg-brand-500/20',
                  unavailable && 'cursor-not-allowed text-muted-foreground/35'
                )}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            'w-full justify-start bg-muted text-left font-normal text-foreground',
            !from && 'text-muted-foreground',
            className
          )}
          aria-label={`${label}: ${labelText}`}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-brand-400" />
          <span className="truncate">{labelText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(calc(100vw-2rem),42rem)] border-border bg-card p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {fromDate && !toDate ? 'Ahora elige la fecha final' : 'Elige el primer y el último día'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Mes anterior"
              onClick={() => setViewMonth((month) => subMonths(month, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Mes siguiente"
              onClick={() => setViewMonth((month) => addMonths(month, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {renderMonth(viewMonth)}
          {renderMonth(addMonths(viewMonth, 1), true)}
        </div>
        {(from || to) && (
          <div className="mt-3 flex justify-end border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onFromChange('')
                onToChange('')
              }}
            >
              Limpiar fechas
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
