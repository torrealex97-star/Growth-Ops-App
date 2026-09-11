'use client'

import { cn } from '@/lib/utils'
import { Plus, Trash2, Undo2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { SlideRenderer } from './SlideRenderer'
import type { Slide, AspectRatio } from '@/lib/carruseles/types'

interface Props {
  slides: Slide[]
  aspectRatio: AspectRatio
  activeIndex: number
  onActiveChange: (i: number) => void
  onDeleteSlide: (slideId: string) => void
  onUndoSlide: (slideId: string) => void
  onAddSlideRequest: () => void
  onReorder: (slideIds: string[]) => void
  isGenerating: boolean
}

export function SlideFilmstrip({
  slides,
  aspectRatio,
  activeIndex,
  onActiveChange,
  onDeleteSlide,
  onUndoSlide,
  onAddSlideRequest,
  onReorder,
  isGenerating,
}: Props) {
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= slides.length) return
    const ids = slides.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    onReorder(ids)
  }

  return (
    <div className="border-t border-border bg-card px-4 py-3 shrink-0">
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        {slides.map((slide, i) => (
          <div key={slide.id} className="relative shrink-0 group">
            <button
              onClick={() => onActiveChange(i)}
              className={cn(
                'relative rounded-lg overflow-hidden border-2 transition-colors bg-background',
                i === activeIndex ? 'border-brand-400' : 'border-transparent hover:border-border'
              )}
              style={{ width: 76, height: aspectRatio === '9:16' ? 135 : aspectRatio === 'A4' ? 107 : 95 }}
            >
              <SlideRenderer html={slide.html} aspectRatio={aspectRatio} style={{ width: '100%', height: '100%' }} />
              <span className="absolute bottom-0.5 left-0.5 text-[9px] font-semibold bg-black/60 text-white rounded px-1">
                {i + 1}
              </span>
            </button>

            {/* Controles */}
            <div className="absolute -top-2 -right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {slide.previousVersions.length > 0 && (
                <button
                  onClick={() => onUndoSlide(slide.id)}
                  className="h-5 w-5 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shadow"
                  title="Deshacer último cambio"
                >
                  <Undo2 className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => onDeleteSlide(slide.id)}
                className="h-5 w-5 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-destructive shadow"
                title="Eliminar slide"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="h-5 w-5 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 shadow"
                title="Mover a la izquierda"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === slides.length - 1}
                className="h-5 w-5 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 shadow"
                title="Mover a la derecha"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}

        {isGenerating && (
          <div
            className="shrink-0 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground"
            style={{ width: 76, height: aspectRatio === '9:16' ? 135 : aspectRatio === 'A4' ? 107 : 95 }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        <button
          onClick={onAddSlideRequest}
          className="shrink-0 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-brand-400 hover:border-brand-400 transition-colors"
          style={{ width: 76, height: aspectRatio === '9:16' ? 135 : aspectRatio === 'A4' ? 107 : 95 }}
          title="Pedir una slide nueva a la IA"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
