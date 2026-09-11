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
    <div className="group relative overflow-hidden rounded-2xl border border-[#26262A] bg-[#141416] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_24px_rgba(0,0,0,0.3)] transition-colors hover:bg-[#1C1C1F]">
      <div className="flex items-start justify-between mb-4">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#26262A] bg-[#0A0A0B]">
            <Icon className="w-4 h-4 text-[#A1A1AA]" />
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
            <span className="text-[30px] font-semibold tracking-tight text-white">{value}</span>
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
