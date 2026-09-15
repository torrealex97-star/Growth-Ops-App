import type { ReactNode } from 'react'
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
  // Comparación explícita (punto 12: nunca mostrar "+23%" sin decir contra qué).
  compareLabel?: string
  // Sparkline opcional (recharts) — solo para KPIs donde la tendencia rápida aporta (punto 11).
  spark?: ReactNode
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
  compareLabel,
  spark,
}: KPICardProps) {
  return (
    <div className="group relative overflow-hidden dashboard-card p-5">
      <div className="flex items-start justify-between mb-4">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted/50">
            <Icon className="w-4 h-4 text-muted-foreground" />
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
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-baseline gap-1">
              {prefix && <span className="text-lg text-muted-foreground">{prefix}</span>}
              <span className="font-display text-[clamp(1.4rem,2.2vw,1.875rem)] font-semibold tracking-tight text-foreground tabular-nums">
                {value}
              </span>
              {suffix && <span className="text-lg text-muted-foreground">{suffix}</span>}
            </div>
            {spark && <div className="h-10 w-20 shrink-0">{spark}</div>}
          </div>

          {(delta !== undefined || description) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {delta !== undefined && deltaType && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-xs font-medium',
                    deltaType === 'up' && 'text-emerald-400',
                    deltaType === 'down' && 'text-red-400',
                    deltaType === 'neutral' && 'text-muted-foreground'
                  )}
                >
                  {deltaType === 'up' && <TrendingUp className="w-3 h-3" />}
                  {deltaType === 'down' && <TrendingDown className="w-3 h-3" />}
                  {deltaType === 'neutral' && <Minus className="w-3 h-3" />}
                  {delta > 0 ? '+' : ''}
                  {delta}%
                </span>
              )}
              {(compareLabel ?? description) && (
                <span className="text-xs text-muted-foreground">{compareLabel ?? description}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
