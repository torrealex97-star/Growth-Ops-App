'use client'

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { wrapSlideHtml } from '@/lib/carruseles/slide-html'
import type { AspectRatio } from '@/lib/carruseles/types'
import { DIMENSIONS } from '@/lib/carruseles/types'

interface SlideRendererProps {
  html: string
  aspectRatio: AspectRatio
  className?: string
  style?: React.CSSProperties
}

export function SlideRenderer({ html, aspectRatio, className, style }: SlideRendererProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const { width: slideW, height: slideH } = DIMENSIONS[aspectRatio]

  const srcDoc = useMemo(() => wrapSlideHtml(html, aspectRatio), [html, aspectRatio])

  const measure = useCallback(() => {
    const el = outerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) setDims({ w: rect.width, h: rect.height })
  }, [])

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => measure())
    obs.observe(el)
    measure()
    return () => obs.disconnect()
  }, [measure])

  const scale = dims ? Math.min(dims.w / slideW, dims.h / slideH) : 0
  const scaledW = Math.floor(slideW * scale)
  const scaledH = Math.floor(slideH * scale)

  return (
    <div
      ref={outerRef}
      className={className}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}
    >
      {scale > 0 && (
        <div
          style={{
            width: scaledW,
            height: scaledH,
            overflow: 'hidden',
            borderRadius: 10,
            position: 'relative',
            boxShadow: '0 8px 30px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <iframe
            sandbox=""
            srcDoc={srcDoc}
            title="Slide preview"
            style={{
              width: slideW,
              height: slideH,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
    </div>
  )
}
