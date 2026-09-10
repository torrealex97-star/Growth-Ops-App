'use client'

import { Sparkle } from 'lucide-react'
import { getDailyQuote } from '@/lib/quotes'

// Misma frase para todo el equipo el mismo día — pequeño ritual compartido al abrir el dashboard.
export function DailyQuoteWidget() {
  const quote = getDailyQuote()

  return (
    <div className="rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-transparent p-4 mb-6">
      <div className="flex items-start gap-3">
        <Sparkle className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-foreground italic leading-relaxed">&ldquo;{quote}&rdquo;</p>
      </div>
    </div>
  )
}
