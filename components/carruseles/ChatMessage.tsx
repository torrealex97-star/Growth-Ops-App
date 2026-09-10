"use client"

import { cn } from "@/lib/utils"

interface Props {
  role: "user" | "assistant"
  content: string
  isStreaming?: boolean
}

export function ChatMessage({ role, content, isStreaming }: Props) {
  const isUser = role === "user"
  return (
    <div className={cn("px-4 py-2.5", isUser ? "" : "bg-muted/40")}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {isUser ? "Tú" : "IA"}
      </div>
      <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed break-words">
        {content}
        {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-brand-400 ml-0.5 animate-pulse align-middle" />}
      </div>
    </div>
  )
}
