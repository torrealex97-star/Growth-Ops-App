import { cn } from '@/lib/utils'

// Primitivo compartido — sustituye a los `<div className="... animate-pulse" />` sueltos
// repetidos por ~20 pantallas (ver PROMPT_UXUI_AUDIT.md #8, #62). Aproxima el layout final
// (altura/ancho vía className) para no producir layout shift al reemplazarse por contenido real.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-lg bg-card', className)} {...props} />
}

export { Skeleton }
