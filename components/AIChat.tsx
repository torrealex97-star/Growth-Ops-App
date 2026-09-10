'use client'

import { useState, useRef, useEffect } from 'react'
import type { ChatMessage, DashboardData } from '@/lib/types'

interface AIChatProps {
  dashboardData: DashboardData | null
}

const SUGGESTED_QUESTIONS = [
  '¿Qué anuncio está trayendo mejores leads?',
  '¿Cuál es el perfil mayoritario de lead?',
  '¿Qué porcentaje ha completado la encuesta?',
  '¿Qué quieren aprender la mayoría?',
  '¿De dónde viene la mayoría de leads?',
  '¿Cómo va el lanzamiento para el 6 de mayo?',
]

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2a10 10 0 110 20 10 10 0 010-20zm0 4a3 3 0 100 6 3 3 0 000-6zm0 13a7 7 0 01-5.5-2.67C7.5 14.5 9.6 13.5 12 13.5s4.5 1 5.5 2.83A7 7 0 0112 19z"
              fill="#C9477A"
            />
          </svg>
        </div>
      )}
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-[#C9477A] text-foreground rounded-tr-sm'
            : 'bg-[#222238] text-[#e2e8f0] border border-[#2a2a3e] rounded-tl-sm'
        }`}
      >
        {msg.content.split('\n').map((line, i) => (
          <span key={i}>
            {line}
            {i < msg.content.split('\n').length - 1 && <br />}
          </span>
        ))}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="w-7 h-7 rounded-full bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center mr-2 flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2a10 10 0 110 20 10 10 0 010-20zm0 4a3 3 0 100 6 3 3 0 000-6zm0 13a7 7 0 01-5.5-2.67C7.5 14.5 9.6 13.5 12 13.5s4.5 1 5.5 2.83A7 7 0 0112 19z"
            fill="#C9477A"
          />
        </svg>
      </div>
      <div className="bg-[#222238] border border-[#2a2a3e] rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 bg-[#C9477A] rounded-full animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function AIChat({ dashboardData }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return
    setError('')

    const userMsg: ChatMessage = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages([...newMessages, assistantMsg])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          context: dashboardData,
        }),
      })

      if (!res.ok) {
        throw new Error(`Error ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      if (!reader) throw new Error('No stream reader')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.text) {
                fullText += parsed.text
                setMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: fullText,
                  }
                  return updated
                })
              }
              if (parsed.error) {
                throw new Error(parsed.error)
              }
            } catch (parseErr) {
              // Skip non-JSON lines
            }
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error al conectar con la IA'
      )
      setMessages((prev) => prev.slice(0, -1)) // Remove empty assistant message
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  const hasMessages = messages.length > 0

  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">
          Preguntale a la IA sobre tu lanzamiento
        </h2>
        <span className="text-xs text-[#C9477A] bg-[#C9477A]/10 border border-[#C9477A]/20 px-2 py-0.5 rounded-full">
          claude-sonnet-4-6
        </span>
      </div>

      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
        {/* Messages area */}
        <div className="min-h-[280px] max-h-[420px] overflow-y-auto p-5">
          {!hasMessages ? (
            <div className="flex flex-col items-center justify-center h-full py-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#C9477A]/10 border border-[#C9477A]/20 flex items-center justify-center mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    stroke="#C9477A"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-[#94a3b8] text-sm mb-1">
                Haz una pregunta sobre tus datos
              </p>
              <p className="text-[#4a4a6a] text-xs">
                La IA tiene acceso a todos los datos del lanzamiento
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <MessageBubble key={idx} msg={msg} />
              ))}
              {streaming && messages[messages.length - 1]?.content === '' && (
                <TypingIndicator />
              )}
            </>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl mt-2">
              <svg
                className="w-4 h-4 text-red-400 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested questions */}
        {!hasMessages && (
          <div className="px-5 pb-3">
            <p className="text-xs text-[#4a4a6a] mb-2 uppercase tracking-wider">
              Sugerencias
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={streaming}
                  className="text-xs px-3 py-1.5 bg-[#0f0f1a] border border-[#2a2a3e] hover:border-[#C9477A]/40 hover:text-foreground text-[#94a3b8] rounded-full transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-[#2a2a3e] p-4">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta algo sobre tus leads, anuncios o lanzamiento..."
              disabled={streaming}
              className="flex-1 px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-foreground placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] disabled:opacity-50 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || streaming}
              className="px-4 py-2.5 bg-[#C9477A] hover:bg-[#E8729A] disabled:opacity-50 disabled:cursor-not-allowed text-foreground rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
            >
              {streaming ? (
                <svg
                  className="animate-spin w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              Enviar
            </button>
          </form>

          {hasMessages && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {SUGGESTED_QUESTIONS.slice(0, 3).map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={streaming}
                  className="text-xs px-2.5 py-1 bg-[#0f0f1a] border border-[#2a2a3e] hover:border-[#C9477A]/40 hover:text-foreground text-[#4a4a6a] rounded-full transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
