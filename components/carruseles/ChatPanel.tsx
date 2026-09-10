"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { ReferenceImages } from "./ReferenceImages"
import { AlertCircle } from "lucide-react"
import { toast } from "sonner"
import type { ReferenceImage } from "@/lib/carruseles/types"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

interface Props {
  projectId: string
  referenceImages: ReferenceImage[]
  onStreamStart?: () => void
  onRefresh?: () => void
  onStreamEnd?: () => void
  chatInputRef?: React.Ref<HTMLTextAreaElement>
}

export function ChatPanel({
  projectId,
  referenceImages,
  onStreamStart,
  onRefresh,
  onStreamEnd,
  chatInputRef,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`carrusel-chat-${projectId}`)
      if (stored) setMessages(JSON.parse(stored))
    } catch {
      /* ignore */
    }
  }, [projectId])

  const persist = useCallback(
    (msgs: Message[]) => {
      try {
        localStorage.setItem(`carrusel-chat-${projectId}`, JSON.stringify(msgs.slice(-40)))
      } catch {
        /* ignore */
      }
    },
    [projectId]
  )

  const clearChat = useCallback(() => {
    setMessages([])
    localStorage.removeItem(`carrusel-chat-${projectId}`)
  }, [projectId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const handleSend = useCallback(
    async (message: string) => {
      if (isStreaming) return
      setError(null)
      setIsStreaming(true)
      onStreamStart?.()

      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: message }
      const assistantId = crypto.randomUUID()
      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }])

      abortRef.current = new AbortController()
      let accumulated = ""

      try {
        const res = await fetch("/api/evergreen/carruseles/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, projectId, history }),
          signal: abortRef.current.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error || "Error de conexión con la IA")
        }
        const reader = res.body?.getReader()
        if (!reader) throw new Error("Sin stream de respuesta")
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === "token" && typeof data.text === "string") {
                accumulated += data.text
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)))
              } else if (data.type === "refresh") {
                onRefresh?.()
              } else if (data.type === "error") {
                setError(data.error || "Error")
              } else if (data.type === "warning" && data.warning) {
                toast.warning(data.warning)
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // conserva lo generado
        } else {
          setError(err instanceof Error ? err.message : "Error inesperado")
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
        setMessages((prev) => {
          const cleaned = prev.filter((m) => m.role !== "assistant" || m.id !== assistantId || m.content.length > 0)
          persist(cleaned)
          return cleaned
        })
        onStreamEnd?.()
        onRefresh?.()
      }
    },
    [isStreaming, messages, projectId, onStreamStart, onStreamEnd, onRefresh, persist]
  )

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">Asistente IA</h2>
          <p className="text-xs text-muted-foreground">Describe el diseño que quieres crear</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors px-1.5 py-0.5"
          >
            Limpiar
          </button>
        )}
      </div>

      <ReferenceImages projectId={projectId} images={referenceImages} onChange={() => onRefresh?.()} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="p-6 text-center text-muted-foreground">
            <p className="text-sm mb-1">Sin mensajes todavía</p>
            <p className="text-xs">Dime qué carrusel o flyer quieres crear.</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            isStreaming={isStreaming && msg.role === "assistant" && msg.id === messages[messages.length - 1]?.id}
          />
        ))}
        {error && (
          <div className="mx-4 my-2 flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        isStreaming={isStreaming}
        textareaRef={chatInputRef}
        onStop={() => abortRef.current?.abort()}
      />
    </div>
  )
}
