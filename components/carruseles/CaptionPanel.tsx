"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"

interface Props {
  caption: string | null
  hashtags: string[]
}

export function CaptionPanel({ caption, hashtags }: Props) {
  const [copied, setCopied] = useState(false)
  if (!caption && (!hashtags || hashtags.length === 0)) return null

  const full = [caption || "", (hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")]
    .filter(Boolean)
    .join("\n\n")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="border-t border-border bg-card px-4 py-3 shrink-0 max-h-40 overflow-y-auto">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Copy para Instagram
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {caption && <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{caption}</p>}
      {hashtags && hashtags.length > 0 && (
        <p className="text-xs text-brand-400 mt-1.5">
          {hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
        </p>
      )}
    </div>
  )
}
