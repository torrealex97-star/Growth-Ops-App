import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface KPICardProps {
  title: string
  value: string | number
  prefix?: string
  suffix?: string
  delta?: number
  deltaType?: 'up' | 'down' | 'neutral'
  icon?: LucideIcon
  loading?: boolean
  description?: string
}

export function KPICard({
  title,
  value,
  prefix,
  suffix,
  delta,
  deltaType,
  icon: Icon,
  loading = false,
  description,
}: KPICardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 lift hover:border-brand-500/40">
      {/* Acento superior que aparece al pasar el ratón */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex items-start justify-between mb-4">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="w-9 h-9 rounded-lg bg-brand-600/15 ring-1 ring-brand-500/20 flex items-center justify-center transition-all duration-300 group-hover:bg-brand-600/25 group-hover:ring-brand-500/40 group-hover:shadow-[0_0_16px_-4px_rgba(30,158,255,0.6)]">
            <Icon className="w-4 h-4 text-brand-400" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-32 bg-muted animate-pulse rounded" />
          <div className="h-4 w-20 bg-muted animate-pulse rounded" />
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-1">
            {prefix && <span className="text-lg text-muted-foreground">{prefix}</span>}
            <span className="text-2xl font-bold text-foreground">{value}</span>
            {suffix && <span className="text-lg text-muted-foreground">{suffix}</span>}
          </div>

          {(delta !== undefined || description) && (
            <div className="mt-2 flex items-center gap-2">
              {delta !== undefined && deltaType && (
                <span className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium',
                  deltaType === 'up' && 'text-emerald-400',
                  deltaType === 'down' && 'text-red-400',
                  deltaType === 'neutral' && 'text-muted-foreground',
                )}>
                  {deltaType === 'up' && <TrendingUp className="w-3 h-3" />}
                  {deltaType === 'down' && <TrendingDown className="w-3 h-3" />}
                  {deltaType === 'neutral' && <Minus className="w-3 h-3" />}
                  {delta > 0 ? '+' : ''}{delta}%
                </span>
              )}
              {description && (
                <span className="text-xs text-muted-foreground">{description}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
