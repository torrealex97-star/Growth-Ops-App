'use client'

import { cn } from '@/lib/utils'
import type { AspectRatio, ProjectKind } from '@/lib/carruseles/types'

const CAROUSEL_RATIOS: AspectRatio[] = ['1:1', '4:5', '9:16']
const FLYER_RATIOS: AspectRatio[] = ['A4', '3:4', '1:1', '9:16']

interface Props {
  value: AspectRatio
  kind: ProjectKind
  onChange: (r: AspectRatio) => void
}

export function AspectRatioSelector({ value, kind, onChange }: Props) {
  const ratios = kind === 'flyer' ? FLYER_RATIOS : CAROUSEL_RATIOS
  return (
    <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
      {ratios.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded transition-colors',
            value === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {r}
        </button>
      ))}
    </div>
  )
}
