import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Primitivo compartido para estados vacíos (PROMPT_UXUI_AUDIT.md #8, #63) — antes cada pantalla
// escribía su propio bloque "icono + título + texto" a mano con estilos ligeramente distintos.
interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 text-center', className)}>
      {Icon && <Icon className="w-12 h-12 text-muted-foreground mb-4" />}
      <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
      {description && <p className="text-muted-foreground text-sm max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export { EmptyState }
