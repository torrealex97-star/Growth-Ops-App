'use client'

import { useState, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'

interface Props {
  onSend: (message: string) => void
  isStreaming: boolean
  onStop: () => void
  textareaRef?: React.Ref<HTMLTextAreaElement>
}

export function ChatInput({ onSend, isStreaming, onStop, textareaRef }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-border p-3">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ej: Crea un carrusel de 6 slides sobre cómo empezar en ventas..."
          rows={2}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="absolute right-2 bottom-2 h-7 w-7 rounded-md bg-destructive/90 hover:bg-destructive text-white flex items-center justify-center"
            title="Detener"
          >
            <Square className="h-3.5 w-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="absolute right-2 bottom-2 h-7 w-7 rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white flex items-center justify-center"
            title="Enviar"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
