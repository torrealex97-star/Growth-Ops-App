'use client'
import { useTenant } from '@/lib/tenant-context'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_BASE_PROMPT, BRAND, BRAND_PERSON } from '@/lib/setting-ai/default-prompt'
import {
  Bot,
  Plus,
  X,
  Sparkles,
  RotateCcw,
  Trash2,
  Play,
  Send,
  Search,
  Pencil,
  Copy,
  Download,
  Check,
  MessageCircle,
  GraduationCap,
} from 'lucide-react'
import ConversacionesTab from './ConversacionesTab'

type Who = 'lead' | 'agent'
interface Msg {
  who: Who
  text: string
  id: string
}
interface Thread {
  id: string
  name: string
  conversation: Msg[]
}
interface Corr {
  id: string
  leadMsg?: string
  agentMsg?: string
  note?: string
  better?: string
  auto?: boolean
  severidad?: string
}
interface Persona {
  avatar: number
  registro: string
  dureza: string
  objecion: string
}

let _c = 1
const nid = () => 'm' + _c++ + Date.now().toString(36)
const LS = 'settingai_state'

const MODEL_OPTS = [
  { v: 'sonnet', l: 'Sonnet 5 (producción)' },
  { v: 'opus', l: 'Opus 4.6' },
  { v: 'haiku', l: 'Haiku 4.5' },
]
const sevColor: Record<string, string> = {
  critica: 'bg-red-500/20 text-red-300',
  alta: 'bg-amber-500/20 text-amber-300',
  media: 'bg-brand-500/20 text-brand-300',
  baja: 'bg-muted text-muted-foreground',
}

// `catch (e: any)` + `e.message` compila aunque lo lanzado NO sea un Error —un string, un objeto de
// fetch, lo que sea—, y entonces la pantalla enseña "Error: undefined", que es peor que no enseñar nada.
// Con `unknown` el compilador obliga a comprobarlo, y esto da el mensaje real o algo legible.
function mensajeDeError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'fallo inesperado'
}

export default function SettingAIPage() {
  const [topTab, setTopTab] = useState<'entrenamiento' | 'conversaciones'>('entrenamiento')
  return (
    <div className="flex flex-col h-full text-foreground">
      <div className="flex items-center gap-2 px-1 pt-1 pb-2">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setTopTab('entrenamiento')}
            className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold ${topTab === 'entrenamiento' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <GraduationCap className="w-3.5 h-3.5" /> Entrenamiento
          </button>
          <button
            onClick={() => setTopTab('conversaciones')}
            className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold ${topTab === 'conversaciones' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <MessageCircle className="w-3.5 h-3.5" /> Conversaciones
          </button>
        </div>
      </div>
      {topTab === 'entrenamiento' ? <EntrenamientoTab /> : <ConversacionesTab />}
    </div>
  )
}

function EntrenamientoTab() {
  const tenant = useTenant()
  const [threads, setThreads] = useState<Thread[]>([{ id: nid(), name: 'Conversación 1', conversation: [] }])
  const [activeId, setActiveId] = useState<string>('')
  const [corrections, setCorrections] = useState<Corr[]>([])
  const [basePrompt, setBasePrompt] = useState(DEFAULT_BASE_PROMPT)
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState<'me' | 'sim'>('me')
  const [model, setModel] = useState('sonnet')
  const [autocorrect, setAutocorrect] = useState(false)
  const [persona, setPersona] = useState<Persona>({ avatar: 3, registro: 'casual', dureza: 'media', objecion: '' })
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState('')
  const [status, setStatus] = useState('Listo.')
  const [sideTab, setSideTab] = useState<'corr' | 'notes'>('corr')
  const [hydrated, setHydrated] = useState(false)
  const msgEnd = useRef<HTMLDivElement>(null)

  // Modales
  const [improveOpen, setImproveOpen] = useState(false)
  const [improveText, setImproveText] = useState('')
  const [improveTitle, setImproveTitle] = useState('')
  const [improveDone, setImproveDone] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editText, setEditText] = useState('')
  const [copied, setCopied] = useState(false)

  // Auto-entrenamiento
  const [atOpen, setAtOpen] = useState(false)
  const [atStarted, setAtStarted] = useState(false)
  const [atRunning, setAtRunning] = useState(false)
  const [atConvos, setAtConvos] = useState(3)
  const [atTurns, setAtTurns] = useState(5)
  const [atPersonasMode, setAtPersonasMode] = useState<'auto' | 'fixed'>('auto')
  const [atModel, setAtModel] = useState('sonnet')
  const [atStatus, setAtStatus] = useState('')
  const [atLog, setAtLog] = useState<any[]>([])
  const [atCorrs, setAtCorrs] = useState<any[]>([])
  const [atImproved, setAtImproved] = useState('')
  const [atSubTab, setAtSubTab] = useState<'live' | 'convos' | 'mejoras' | 'prompt'>('live')
  const atLogEnd = useRef<HTMLDivElement>(null)

  // ---------- Hydrate ----------
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}')
      if (s.threads?.length) {
        setThreads(s.threads)
        setActiveId(s.activeId || s.threads[0].id)
      } else setActiveId((prev) => prev)
      if (s.corrections) setCorrections(s.corrections)
      if (typeof s.basePrompt === 'string' && s.basePrompt) setBasePrompt(s.basePrompt)
      if (typeof s.notes === 'string') setNotes(s.notes)
      if (s.mode) setMode(s.mode)
      if (s.model) setModel(s.model)
      if (typeof s.autocorrect === 'boolean') setAutocorrect(s.autocorrect)
      if (s.persona) setPersona(s.persona)
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!activeId && threads[0]) setActiveId(threads[0].id)
  }, [activeId, threads])

  // ---------- Persist ----------
  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(
      LS,
      JSON.stringify({ threads, activeId, corrections, basePrompt, notes, mode, model, autocorrect, persona })
    )
  }, [threads, activeId, corrections, basePrompt, notes, mode, model, autocorrect, persona, hydrated])

  useEffect(() => {
    msgEnd.current?.scrollIntoView({ behavior: 'smooth' })
  })
  useEffect(() => {
    atLogEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [atLog, atCorrs])

  const active = threads.find((t) => t.id === activeId) || threads[0]
  const conv = active?.conversation || []

  // ---------- Helpers de estado ----------
  function setConv(updater: (c: Msg[]) => Msg[]) {
    setThreads((ts) => ts.map((t) => (t.id === activeId ? { ...t, conversation: updater(t.conversation) } : t)))
  }
  function liveSystemPrompt() {
    let sys = basePrompt
    if (corrections.length) {
      sys += '\n\n## ⚠️ CORRECCIONES EN VIVO (reglas obligatorias, prioridad máxima)\n'
      corrections.forEach((c, i) => {
        sys += `\n${i + 1}. ${c.note || ''}${c.better ? ` — mejor: "${c.better}"` : ''}`
      })
    }
    return sys
  }
  const splitBubbles = (t: string) =>
    t
      .split(/\n{2,}/)
      .map((x) => x.trim())
      .filter(Boolean)

  // ---------- API ----------
  async function agentReply(currentConv: Msg[]) {
    setTyping('Escribiendo…')
    try {
      const r = await fetch(`/api/${tenant}/evergreen/setting-ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation: currentConv, system: liveSystemPrompt(), model }),
      }).then((r) => r.json())
      if (r.error) throw new Error(r.error)
      const withAgent = [...currentConv, { who: 'agent' as Who, text: r.text, id: nid() }]
      setConv(() => withAgent)
      setTyping('')
      if (autocorrect) await autoCorrect(withAgent)
    } catch (e: unknown) {
      setStatus('Error: ' + mensajeDeError(e))
      setTyping('')
    }
  }
  async function autoCorrect(currentConv: Msg[]) {
    setStatus('🔍 Analizando la respuesta…')
    try {
      const r = await fetch(`/api/${tenant}/evergreen/setting-ai/critic`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation: currentConv, criticModel: 'haiku' }),
      }).then((r) => r.json())
      const agentMsg = [...currentConv].reverse().find((m) => m.who === 'agent')?.text || ''
      const leadMsg = [...currentConv].reverse().find((m) => m.who === 'lead')?.text || ''
      const add: Corr[] = []
      ;(r.issues || []).forEach((iss: any) => {
        if (iss.severidad === 'baja') return
        add.push({
          id: nid(),
          leadMsg,
          agentMsg,
          note: `[${iss.severidad}] ${iss.regla}: ${iss.nota}`,
          better: iss.better || '',
          auto: true,
          severidad: iss.severidad,
        })
      })
      if (add.length) setCorrections((c) => [...c, ...add])
      setStatus(add.length ? `🔍 ${add.length} autocorrección(es) añadida(s).` : '🔍 Respuesta correcta, sin fallos.')
    } catch (e: unknown) {
      setStatus('Crítico falló: ' + mensajeDeError(e))
    }
  }
  async function sendLead() {
    const t = input.trim()
    if (!t) return
    setInput('')
    const next = [...conv, { who: 'lead' as Who, text: t, id: nid() }]
    setConv(() => next)
    await agentReply(next)
  }
  async function simStep() {
    setTyping('Lead escribiendo…')
    try {
      const r = await fetch(`/api/${tenant}/evergreen/setting-ai/simulate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation: conv, persona, model }),
      }).then((r) => r.json())
      if (r.error) throw new Error(r.error)
      const next = [...conv, { who: 'lead' as Who, text: r.text, id: nid() }]
      setConv(() => next)
      await agentReply(next)
    } catch (e: unknown) {
      setStatus('Error: ' + mensajeDeError(e))
      setTyping('')
    }
  }
  async function regenLast() {
    const idx = [...conv].map((m) => m.who).lastIndexOf('agent')
    if (idx < 0) return
    const trimmed = conv.slice(0, idx)
    setConv(() => trimmed)
    await agentReply(trimmed)
    setStatus(`Regenerada con ${corrections.length} corrección(es).`)
  }

  // ---------- Correcciones manuales ----------
  function startCorrection(m: Msg) {
    const i = conv.findIndex((x) => x.id === m.id)
    let leadMsg = ''
    for (let j = i - 1; j >= 0; j--) {
      if (conv[j].who === 'lead') {
        leadMsg = conv[j].text
        break
      }
    }
    setCorrections((c) => [...c, { id: nid(), leadMsg, agentMsg: m.text, note: '', better: '', auto: false }])
    setSideTab('corr')
  }
  const updateCorr = (id: string, k: 'note' | 'better', v: string) =>
    setCorrections((c) => c.map((x) => (x.id === id ? { ...x, [k]: v } : x)))
  const delCorr = (id: string) => setCorrections((c) => c.filter((x) => x.id !== id))

  // ---------- Threads ----------
  function newThread() {
    const t = { id: nid(), name: 'Conversación ' + (threads.length + 1), conversation: [] }
    setThreads((ts) => [...ts, t])
    setActiveId(t.id)
  }
  function closeThread(id: string) {
    if (threads.length <= 1) {
      setConv(() => [])
      return
    }
    if (!confirm('¿Cerrar esta conversación?')) return
    setThreads((ts) => ts.filter((t) => t.id !== id))
    if (activeId === id) setActiveId(threads.find((t) => t.id !== id)!.id)
  }

  // ---------- SSE reader ----------
  async function readSSE(resp: Response, onEvent: (e: any) => void) {
    const reader = resp.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const p of parts) {
        const line = p.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        try {
          onEvent(JSON.parse(line.slice(5).trim()))
        } catch {
          /* skip */
        }
      }
    }
  }

  // ---------- Export prompt mejorado ----------
  async function improve() {
    if (!corrections.length && !confirm('No hay correcciones. ¿Exportar igualmente una revisión?')) return
    setImproveOpen(true)
    setImproveText('')
    setImproveDone(false)
    setImproveTitle('✨ Generando prompt mejorado…')
    const started = Date.now()
    try {
      const resp = await fetch(`/api/${tenant}/evergreen/setting-ai/improve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ basePrompt, corrections, transcriptNotes: notes, model }),
      })
      let err = false
      await readSSE(resp, (e) => {
        if (e.type === 'token') setImproveText((t) => t + e.text)
        else if (e.type === 'error') {
          err = true
          setImproveText((t) => t + '\n[ERROR] ' + e.error)
        }
      })
      const secs = ((Date.now() - started) / 1000).toFixed(0)
      setImproveTitle(err ? '⚠️ Error al generar' : `✅ Prompt mejorado (${secs}s) — listo para pegar`)
      setImproveDone(true)
      setStatus('Prompt mejorado generado.')
    } catch (e: unknown) {
      setImproveTitle('⚠️ Error')
      setImproveText((t) => t || 'Error: ' + mensajeDeError(e))
      setImproveDone(true)
    }
  }

  // ---------- Auto-entrenamiento ----------
  function openAutotrain() {
    setAtOpen(true)
    setAtStarted(false)
    setAtRunning(false)
    setAtLog([])
    setAtCorrs([])
    setAtImproved('')
    setAtStatus('')
    setAtSubTab('live')
    setAtModel(model)
  }
  async function startAutotrain() {
    setAtStarted(true)
    setAtRunning(true)
    setAtLog([])
    setAtCorrs([])
    setAtImproved('')
    setAtSubTab('live')
    setAtStatus('corriendo…')
    const payload: any = { basePrompt, transcriptNotes: notes, model: atModel, numConvos: atConvos, turns: atTurns }
    if (atPersonasMode === 'fixed') payload.personas = [persona]
    try {
      const resp = await fetch(`/api/${tenant}/evergreen/setting-ai/autotrain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await readSSE(resp, (e) => {
        if (e.type === 'convo-start') setAtLog((l) => [...l, { k: 'h', convo: e.convo, persona: e.persona }])
        else if (e.type === 'lead' || e.type === 'agent') setAtLog((l) => [...l, { k: e.type, text: e.text }])
        else if (e.type === 'critic') setAtLog((l) => [...l, { k: 'crit', ok: e.ok, issues: e.issues || [] }])
        else if (e.type === 'correction') setAtCorrs((c) => [...c, { ...e.correction }])
        else if (e.type === 'improving') setAtStatus('generando prompt mejorado…')
        else if (e.type === 'done') {
          setAtImproved(e.improved || '')
          setAtStatus(`✅ hecho · ${(e.corrections || []).length} mejoras`)
          setAtSubTab('prompt')
        } else if (e.type === 'error') setAtStatus('Error: ' + mensajeDeError(e))
      })
    } catch (e: unknown) {
      setAtStatus('Error: ' + mensajeDeError(e))
    }
    setAtRunning(false)
  }

  const copy = (t: string) => {
    navigator.clipboard.writeText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 1300)
  }
  const download = (name: string, t: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown' }))
    a.download = name
    a.click()
  }

  // ================= UI =================
  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground leading-tight">Setting AI</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {BRAND} · {BRAND_PERSON}
            </p>
          </div>
        </div>
        <div className="flex-1" />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="bg-muted border border-border rounded-lg px-2 py-1.5 text-xs"
        >
          {MODEL_OPTS.map((m) => (
            <option key={m.v} value={m.v}>
              {m.l}
            </option>
          ))}
        </select>
        <button
          onClick={openAutotrain}
          className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" /> Auto-entrenar
        </button>
        <button
          onClick={() => {
            setEditText(basePrompt)
            setEditOpen(true)
          }}
          className="bg-muted hover:bg-muted/70 border border-border rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5"
        >
          <Pencil className="w-3.5 h-3.5" /> Prompt base
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        {/* CHAT */}
        <section className="flex flex-col flex-1 min-w-0 border-r border-border">
          {/* Thread tabs */}
          <div className="flex gap-1.5 items-center px-1 py-2 overflow-x-auto border-b border-border">
            {threads.map((t) => (
              <div
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap cursor-pointer border ${t.id === activeId ? 'border-brand-500 bg-brand-600/15 text-brand-300' : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground'}`}
              >
                <span>{t.name}</span>
                <span className="text-muted-foreground">({t.conversation.length})</span>
                <X
                  className="w-3 h-3 hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeThread(t.id)
                  }}
                />
              </div>
            ))}
            <button
              onClick={newThread}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs border border-dashed border-border text-muted-foreground hover:text-foreground whitespace-nowrap"
            >
              <Plus className="w-3 h-3" /> Nueva
            </button>
          </div>

          {/* Sub bar */}
          <div className="flex items-center gap-2 flex-wrap px-2 py-2 border-b border-border">
            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
              <button
                onClick={() => setMode('me')}
                className={`px-3 py-1.5 ${mode === 'me' ? 'bg-brand-600 text-white font-semibold' : 'text-muted-foreground'}`}
              >
                🧑 Yo hago de lead
              </button>
              <button
                onClick={() => setMode('sim')}
                className={`px-3 py-1.5 ${mode === 'sim' ? 'bg-brand-600 text-white font-semibold' : 'text-muted-foreground'}`}
              >
                🤖 Lead simulado
              </button>
            </div>
            {mode === 'sim' && (
              <div className="flex gap-1.5 items-end flex-wrap text-[10px] text-muted-foreground">
                <label className="flex flex-col gap-0.5">
                  Avatar
                  <select
                    value={persona.avatar}
                    onChange={(e) => setPersona({ ...persona, avatar: +e.target.value })}
                    className="bg-muted border border-border rounded px-1.5 py-1 text-[11px] text-foreground"
                  >
                    <option value={1}>1 · Emprendedor</option>
                    <option value={2}>2 · Agencia</option>
                    <option value={3}>3 · Trabajador</option>
                    <option value={4}>4 · Empresario</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  Registro
                  <select
                    value={persona.registro}
                    onChange={(e) => setPersona({ ...persona, registro: e.target.value })}
                    className="bg-muted border border-border rounded px-1.5 py-1 text-[11px] text-foreground"
                  >
                    <option value="casual">Casual</option>
                    <option value="serio">Serio</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  Dureza
                  <select
                    value={persona.dureza}
                    onChange={(e) => setPersona({ ...persona, dureza: e.target.value })}
                    className="bg-muted border border-border rounded px-1.5 py-1 text-[11px] text-foreground"
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  Objeción
                  <input
                    value={persona.objecion}
                    onChange={(e) => setPersona({ ...persona, objecion: e.target.value })}
                    placeholder="ej: no tengo dinero"
                    className="bg-muted border border-border rounded px-1.5 py-1 text-[11px] text-foreground w-28"
                  />
                </label>
              </div>
            )}
            <div className="flex-1" />
            <label
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer"
              title="Tras cada respuesta, un crítico la evalúa y añade correcciones"
            >
              <input
                type="checkbox"
                checked={autocorrect}
                onChange={(e) => setAutocorrect(e.target.checked)}
                className="accent-brand-600"
              />{' '}
              <Search className="w-3 h-3" /> Autocorregir
            </label>
            <button
              onClick={() => {
                if (conv.length === 0 || confirm('¿Que abra el DM el agente ahora?')) agentReply(conv)
              }}
              className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
            >
              ▶️ Que abra
            </button>
            {mode === 'sim' && (
              <button
                onClick={simStep}
                className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
              >
                🤖 Lead escribe
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">
            {conv.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col max-w-[78%] ${m.who === 'lead' ? 'self-end items-end' : 'self-start items-start'}`}
              >
                {m.who === 'agent' ? (
                  splitBubbles(m.text).map((b, i) => (
                    <div
                      key={i}
                      className="bg-muted rounded-2xl rounded-bl-md px-3 py-2 text-sm mb-0.5 whitespace-pre-wrap"
                    >
                      {b}
                    </div>
                  ))
                ) : (
                  <div className="bg-brand-600 rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.text}
                  </div>
                )}
                {m.who === 'agent' && (
                  <div className="flex items-center gap-1.5 mt-0.5 mb-1">
                    <button
                      onClick={() => startCorrection(m)}
                      className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-amber-300 hover:border-amber-500/50"
                    >
                      ✏️ Corregir
                    </button>
                    {corrections
                      .filter((c) => c.auto && c.agentMsg === m.text)
                      .map((c) => (
                        <span
                          key={c.id}
                          className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${sevColor[c.severidad || 'media']}`}
                        >
                          {c.severidad}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            ))}
            {typing && <div className="self-start text-xs text-muted-foreground italic px-3 py-1.5">{typing}</div>}
            <div ref={msgEnd} />
          </div>

          {/* Composer */}
          {mode === 'me' && (
            <div className="flex gap-2 p-3 border-t border-border">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendLead()
                  }
                }}
                placeholder="Escribe como el lead…  (Enter envía)"
                className="flex-1 resize-none bg-muted border border-border rounded-xl px-3 py-2.5 text-sm min-h-[44px] max-h-32"
              />
              <button
                onClick={sendLead}
                aria-label="Enviar mensaje"
                className="self-end bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>

        {/* SIDE */}
        <aside className="flex flex-col w-[42%] min-w-0">
          <div className="flex border-b border-border text-sm">
            <button
              onClick={() => setSideTab('corr')}
              className={`flex-1 py-2.5 border-b-2 ${sideTab === 'corr' ? 'text-white border-brand-500' : 'text-muted-foreground border-transparent'}`}
            >
              📝 Correcciones ({corrections.length})
            </button>
            <button
              onClick={() => setSideTab('notes')}
              className={`flex-1 py-2.5 border-b-2 ${sideTab === 'notes' ? 'text-white border-brand-500' : 'text-muted-foreground border-transparent'}`}
            >
              🎙️ Contexto / notas
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {sideTab === 'corr' ? (
              corrections.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-10 leading-relaxed">
                  Aún no hay correcciones.
                  <br />
                  <br />
                  Pulsa <b>✏️ Corregir</b> bajo una respuesta, o activa <b>🔍 Autocorregir</b> para que un crítico las
                  genere solo. Se aplican <b>en vivo</b> al agente.
                </p>
              ) : (
                corrections.map((c) => (
                  <div
                    key={c.id}
                    className={`bg-muted/60 border border-border rounded-xl p-3 mb-2.5 ${c.auto ? 'border-l-2 border-l-amber-500' : ''}`}
                  >
                    <div className="flex justify-between items-center mb-1.5">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${c.auto ? sevColor[c.severidad || 'media'] : 'bg-emerald-500/20 text-emerald-300'}`}
                      >
                        {c.auto ? 'auto · ' + (c.severidad || '') : 'manual'}
                      </span>
                      <button onClick={() => delCorr(c.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground mb-1.5 border-l-2 border-border pl-2">
                      <b className="text-foreground font-medium">Lead:</b> {c.leadMsg || '—'}
                      <br />
                      <b className="text-foreground font-medium">Agente:</b> {c.agentMsg || '—'}
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">¿Qué mejorar? (regla)</p>
                    <textarea
                      value={c.note || ''}
                      onChange={(e) => updateCorr(c.id, 'note', e.target.value)}
                      className="w-full bg-background border border-border rounded-lg p-2 text-xs mb-1.5 min-h-[40px]"
                    />
                    <p className="text-[10px] text-muted-foreground mb-0.5">Cómo debería haber respondido (opcional)</p>
                    <textarea
                      value={c.better || ''}
                      onChange={(e) => updateCorr(c.id, 'better', e.target.value)}
                      className="w-full bg-background border border-border rounded-lg p-2 text-xs min-h-[40px]"
                    />
                  </div>
                ))
              )
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Contexto extra de la empresa/voz que quieras dar al motor de mejora del prompt (historia, muletillas,
                  casos, datos). Se guarda solo.
                </p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contexto y aprendizajes de voz…"
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-xs min-h-[200px]"
                />
              </>
            )}
          </div>
          <div className="p-3 border-t border-border flex flex-col gap-2">
            <button
              onClick={regenLast}
              className="w-full bg-muted hover:bg-muted/70 border border-border rounded-lg py-2 text-xs flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Regenerar última con correcciones
            </button>
            <div className="flex gap-2">
              <button
                onClick={improve}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" /> Exportar prompt mejorado
              </button>
              <button
                onClick={() => {
                  if (confirm('¿Vaciar esta conversación? (Las correcciones se mantienen)')) setConv(() => [])
                }}
                className="bg-muted hover:bg-muted/70 border border-border rounded-lg px-3 py-2 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">{status}</span>
          </div>
        </aside>
      </div>

      {/* ---------- Modal: prompt mejorado ---------- */}
      {improveOpen && (
        <Modal onClose={() => setImproveOpen(false)}>
          <ModalHead title={improveTitle} />
          <div className="flex-1 overflow-auto p-4">
            <textarea
              value={improveText}
              onChange={(e) => setImproveText(e.target.value)}
              className="w-full h-full min-h-[400px] bg-background border border-border rounded-lg p-3 text-xs font-mono leading-relaxed"
            />
          </div>
          <div className="p-3 border-t border-border flex gap-2 justify-end flex-wrap">
            {improveDone && (
              <>
                <button
                  onClick={() => {
                    if (confirm('¿Reemplazar el prompt base por esta versión?')) {
                      setBasePrompt(improveText)
                      setImproveOpen(false)
                      setStatus('Prompt base actualizado.')
                    }
                  }}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs"
                >
                  ✅ Usar como base
                </button>
                <button
                  onClick={() => download('prompt-mejorado.md', improveText)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Descargar
                </button>
                <button
                  onClick={() => copy(improveText)}
                  className="bg-brand-600 text-white rounded-lg px-3 py-2 text-xs flex items-center gap-1"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copiar
                </button>
              </>
            )}
            <button onClick={() => setImproveOpen(false)} className="border border-border rounded-lg px-3 py-2 text-xs">
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {/* ---------- Modal: editar prompt base ---------- */}
      {editOpen && (
        <Modal onClose={() => setEditOpen(false)}>
          <ModalHead title="✏️ Prompt base (editable)" />
          <div className="flex-1 overflow-auto p-4">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full h-full min-h-[400px] bg-background border border-border rounded-lg p-3 text-xs font-mono leading-relaxed"
            />
          </div>
          <div className="p-3 border-t border-border flex gap-2 justify-end">
            <button
              onClick={() => {
                setBasePrompt(editText)
                setEditOpen(false)
                setStatus('Prompt base guardado.')
              }}
              className="bg-brand-600 text-white rounded-lg px-3 py-2 text-xs"
            >
              💾 Guardar
            </button>
            <button onClick={() => setEditOpen(false)} className="border border-border rounded-lg px-3 py-2 text-xs">
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {/* ---------- Modal: auto-entrenamiento ---------- */}
      {atOpen && (
        <Modal big onClose={() => setAtOpen(false)}>
          <ModalHead
            title={
              <span>
                🤖 Auto-entrenamiento{' '}
                {atStatus && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {atRunning ? '⏳ ' : ''}
                    {atStatus}
                  </span>
                )}
              </span>
            }
          />
          <div className="flex-1 overflow-auto p-4">
            {!atStarted ? (
              <div className="flex gap-4 items-end flex-wrap">
                <label className="text-[11px] text-muted-foreground flex flex-col gap-1">
                  Conversaciones
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={atConvos}
                    onChange={(e) => setAtConvos(+e.target.value)}
                    className="w-24 bg-muted border border-border rounded px-2 py-1.5 text-foreground text-sm"
                  />
                </label>
                <label className="text-[11px] text-muted-foreground flex flex-col gap-1">
                  Turnos c/u
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={atTurns}
                    onChange={(e) => setAtTurns(+e.target.value)}
                    className="w-24 bg-muted border border-border rounded px-2 py-1.5 text-foreground text-sm"
                  />
                </label>
                <label className="text-[11px] text-muted-foreground flex flex-col gap-1">
                  Personas
                  <select
                    value={atPersonasMode}
                    onChange={(e) => setAtPersonasMode(e.target.value as any)}
                    className="bg-muted border border-border rounded px-2 py-1.5 text-foreground text-sm"
                  >
                    <option value="auto">Automáticas (variadas)</option>
                    <option value="fixed">La del panel</option>
                  </select>
                </label>
                <label className="text-[11px] text-muted-foreground flex flex-col gap-1">
                  Modelo agente
                  <select
                    value={atModel}
                    onChange={(e) => setAtModel(e.target.value)}
                    className="bg-muted border border-border rounded px-2 py-1.5 text-foreground text-sm"
                  >
                    {MODEL_OPTS.map((m) => (
                      <option key={m.v} value={m.v}>
                        {m.l}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={startAutotrain}
                  className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
                >
                  <Play className="w-4 h-4" /> Empezar
                </button>
                <p className="text-[11px] text-muted-foreground w-full">
                  El lead y el crítico usan Haiku (rápido y barato). El agente usa el modelo elegido.
                </p>
              </div>
            ) : (
              <>
                <div className="flex gap-1.5 mb-3">
                  {(['live', 'convos', 'mejoras', 'prompt'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setAtSubTab(k)}
                      className={`px-3 py-1.5 text-xs rounded border ${atSubTab === k ? 'bg-brand-600 border-brand-600 text-white font-semibold' : 'border-border text-muted-foreground'}`}
                    >
                      {k === 'live'
                        ? '🔴 En vivo'
                        : k === 'convos'
                          ? '💬 Conversaciones'
                          : k === 'mejoras'
                            ? `🛠️ Mejoras (${atCorrs.length})`
                            : '📄 Prompt final'}
                    </button>
                  ))}
                </div>
                {atSubTab === 'prompt' ? (
                  <textarea
                    value={atImproved}
                    onChange={(e) => setAtImproved(e.target.value)}
                    className="w-full min-h-[420px] bg-background border border-border rounded-lg p-3 text-xs font-mono leading-relaxed"
                  />
                ) : (
                  <div className={`grid gap-3 ${atSubTab === 'live' ? 'grid-cols-[1.4fr_.9fr]' : 'grid-cols-1'}`}>
                    {atSubTab !== 'mejoras' && (
                      <div className="bg-background border border-border rounded-lg p-3 max-h-[52vh] overflow-auto">
                        {atLog.map((e, i) =>
                          e.k === 'h' ? (
                            <div
                              key={i}
                              className="text-[11px] text-brand-400 font-semibold mt-3 pt-2 border-t border-dashed border-border first:border-0 first:mt-0"
                            >
                              💬 Conversación {e.convo + 1} · avatar {e.persona.avatar}, {e.persona.registro}, dureza{' '}
                              {e.persona.dureza}, obj: {e.persona.objecion}
                            </div>
                          ) : e.k === 'crit' ? (
                            <div key={i} className="text-[11px] text-muted-foreground my-1">
                              {e.ok ? '   ✅ ok' : '   ⚠️ ' + e.issues.map((x: any) => x.severidad).join(', ')}
                            </div>
                          ) : (
                            <div
                              key={i}
                              className={`text-[12.5px] my-1 px-2.5 py-1.5 rounded-lg max-w-[88%] ${e.k === 'lead' ? 'bg-brand-600/15 ml-auto text-right' : 'bg-muted'}`}
                            >
                              {e.k === 'lead' ? 'Lead: ' : 'Agente: '}
                              {e.text}
                            </div>
                          )
                        )}
                        <div ref={atLogEnd} />
                      </div>
                    )}
                    {atSubTab !== 'convos' && (
                      <div className="bg-background border border-border rounded-lg p-3 max-h-[52vh] overflow-auto">
                        {atCorrs.length === 0 ? (
                          <p className="text-muted-foreground text-xs text-center py-6">Sin correcciones todavía…</p>
                        ) : (
                          atCorrs.map((c, i) => (
                            <div
                              key={i}
                              className="text-[11.5px] bg-muted/60 border-l-2 border-amber-500 rounded-lg p-2 mb-2"
                            >
                              <div className="text-foreground font-semibold">
                                C{c.convo + 1} · {c.note}
                              </div>
                              {c.better && <div className="text-emerald-400 mt-0.5">→ {c.better}</div>}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="p-3 border-t border-border flex gap-2 justify-end flex-wrap">
            {atImproved && (
              <>
                <button
                  onClick={() => {
                    if (confirm('¿Reemplazar el prompt base por el resultado?')) {
                      setBasePrompt(atImproved)
                      setStatus('Prompt base actualizado.')
                    }
                  }}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs"
                >
                  ✅ Usar como base
                </button>
                <button
                  onClick={() => {
                    setCorrections((c) => [
                      ...c,
                      ...atCorrs.map((x) => ({
                        id: nid(),
                        leadMsg: x.leadMsg,
                        agentMsg: x.agentMsg,
                        note: x.note,
                        better: x.better,
                        auto: true,
                        severidad: x.severidad,
                      })),
                    ])
                    setStatus(atCorrs.length + ' mejoras añadidas.')
                  }}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs"
                >
                  ➕ Añadir mejoras a Correcciones
                </button>
                <button
                  onClick={() => copy(atImproved)}
                  className="bg-brand-600 text-white rounded-lg px-3 py-2 text-xs flex items-center gap-1"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copiar
                </button>
                <button
                  onClick={() => download('prompt-autotrain.md', atImproved)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-xs flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Descargar
                </button>
              </>
            )}
            <button onClick={() => setAtOpen(false)} className="border border-border rounded-lg px-3 py-2 text-xs">
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose, big }: { children: ReactNode; onClose: () => void; big?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-card border border-border rounded-2xl flex flex-col ${big ? 'w-[min(1150px,95vw)] h-[min(88vh,900px)]' : 'w-[min(900px,92vw)] h-[min(80vh,760px)]'}`}
      >
        {children}
      </div>
    </div>
  )
}
function ModalHead({ title }: { title: ReactNode }) {
  return <h3 className="px-4 py-3 border-b border-border text-sm text-foreground font-semibold">{title}</h3>
}
