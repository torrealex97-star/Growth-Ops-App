'use client'

// INFO-HINT compartido (regla de UX del proyecto: "si dudas de una métrica, deja el ratón encima
// y sale un mini cartel"). Se abre al pasar el ratón y se CIERRA 20 s después de salir — el tiempo
// justo para leer, copiar la fórmula o apuntar el dato sin que el cartel desaparezca al mover el
// cursor un milímetro. También se cierra con Escape y al hacer clic fuera.
//
// Uso: <InfoHint text="Qué es · fórmula · fuente" /> o <InfoHint label="CPL" text="..." />.

import { useEffect, useRef, useState } from 'react'

const VEINTE_SEGUNDOS_MS = 20_000

export function InfoHint({ label, text }: { label?: string; text: string }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Armado del cierre diferido: hover de nuevo antes de 20 s lo cancela (y re-arma).
  const armClose = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), VEINTE_SEGUNDOS_MS)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <span
      className="relative inline-flex cursor-help items-center gap-1 align-middle"
      onMouseEnter={() => {
        setOpen(true)
        armClose()
      }}
      onMouseLeave={armClose}
      onFocus={() => {
        setOpen(true)
        armClose()
      }}
      onBlur={armClose}
      tabIndex={0}
      role="note"
      aria-label={text}
    >
      {label}
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-muted-foreground/70" fill="currentColor" aria-hidden>
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8.75 12h-1.5V7h1.5v5zm0-6h-1.5V4.5h1.5V6z" />
      </svg>
      {open && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-64 -translate-x-1/2 whitespace-pre-line rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal leading-snug text-popover-foreground opacity-100 shadow-lg transition-opacity">
          {text}
        </span>
      )}
    </span>
  )
}
