'use client'

import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SlideRenderer } from './SlideRenderer'
import type { Slide, AspectRatio } from '@/lib/carruseles/types'

interface Props {
  slides: Slide[]
  aspectRatio: AspectRatio
  activeIndex: number
  onActiveChange: (index: number) => void
}

export function CarouselPreview({ slides, aspectRatio, activeIndex, onActiveChange }: Props) {
  const slide = slides[activeIndex]

  if (!slide) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background/40">
        <div className="text-center text-muted-foreground p-8">
          <div className="w-16 h-20 border-2 border-dashed border-muted-foreground/30 rounded-lg mx-auto mb-4 flex items-center justify-center">
            <ImageIcon className="w-6 h-6 opacity-40" />
          </div>
          <p className="text-sm font-medium">Todavía no hay slides</p>
          <p className="text-xs mt-1 max-w-[220px]">Usa el asistente IA de la izquierda para crear tu primer diseño.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background/40">
      <div className="flex-1 relative min-h-0 p-6 px-14">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onActiveChange(activeIndex - 1)}
          disabled={activeIndex <= 0}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-card/90 shadow-sm hover:bg-card h-9 w-9"
          aria-label="Slide anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div key={slide.id} className="relative w-full h-full">
          <SlideRenderer html={slide.html} aspectRatio={aspectRatio} style={{ width: '100%', height: '100%' }} />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onActiveChange(activeIndex + 1)}
          disabled={activeIndex >= slides.length - 1}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-card/90 shadow-sm hover:bg-card h-9 w-9"
          aria-label="Slide siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-3 shrink-0">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => onActiveChange(i)}
              className={`h-2 rounded-full transition-all duration-200 ${
                i === activeIndex ? 'w-6 bg-brand-400' : 'w-2 bg-foreground/20 hover:bg-foreground/40'
              }`}
              aria-label={`Ir a slide ${i + 1}`}
            />
          ))}
          <span className="text-xs text-muted-foreground ml-2">
            {activeIndex + 1}/{slides.length}
          </span>
        </div>
      )}
    </div>
  )
}
