'use client'

import { useState, useEffect } from 'react'

interface Registro {
  id: string
  total: number
  delta: number
  nota: string | null
  fecha: string
}

function formatFecha(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function WhatsAppTracker() {
  const [registros, setRegistros] = useState<Registro[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [totalInput, setTotalInput] = useState('')
  const [notaInput, setNotaInput] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    fetch('/api/wa-registros')
      .then(r => r.json())
      .then(d => setRegistros(d.registros || []))
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [])

  async function guardar() {
    const total = parseInt(totalInput)
    if (isNaN(total) || total < 0) return
    setGuardando(true)
    try {
      const res = await fetch('/api/wa-registros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total, nota: notaInput.trim() || undefined }),
      })
      const data = await res.json()
      if (data.registro) {
        setRegistros(prev => [data.registro, ...prev])
        setModal(false)
        setTotalInput('')
        setNotaInput('')
      }
    } catch {}
    setGuardando(false)
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este registro?')) return
    await fetch(`/api/wa-registros/${id}`, { method: 'DELETE' })
    setRegistros(prev => prev.filter(r => r.id !== id))
  }

  const ultimo = registros[0]

  return (
    <section>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 bg-[#25d366] rounded-full" />
          <h2 className="text-lg font-bold text-foreground">Grupo WhatsApp</h2>
          {registros.length > 0 && (
            <span className="text-xs text-[#4a4a6a] bg-[#2a2a3e] px-2 py-0.5 rounded-full">
              {registros.length} registros
            </span>
          )}
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#25d366]/10 hover:bg-[#25d366]/20 text-[#25d366] rounded-xl text-xs transition-colors border border-[#25d366]/20"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Añadir registro
        </button>
      </div>

      {cargando ? (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-8 text-center">
          <div className="w-5 h-5 border-2 border-[#25d366]/30 border-t-[#25d366] rounded-full animate-spin mx-auto" />
        </div>
      ) : registros.length === 0 ? (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#25d366]/10 border border-[#25d366]/20 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#25d366">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-[#94a3b8] text-sm mb-1">Sin registros todavía</p>
          <p className="text-[#4a4a6a] text-xs mb-4">Añade el total actual de miembros del grupo para empezar el seguimiento</p>
          <button
            onClick={() => setModal(true)}
            className="px-4 py-2 bg-[#25d366]/10 hover:bg-[#25d366]/20 text-[#25d366] rounded-xl text-sm transition-colors border border-[#25d366]/20"
          >
            Añadir primer registro
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#25d366]/10 border border-[#25d366]/20 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#25d366">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{ultimo.total.toLocaleString('es-ES')}</p>
                <p className="text-xs text-[#4a4a6a]">Miembros actuales</p>
              </div>
            </div>

            <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ultimo.delta > 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : ultimo.delta < 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-[#2a2a3e] border border-[#3a3a5e]'}`}>
                {ultimo.delta > 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                ) : ultimo.delta < 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4a4a6a"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" /></svg>
                )}
              </div>
              <div>
                <p className={`text-2xl font-bold ${ultimo.delta > 0 ? 'text-emerald-400' : ultimo.delta < 0 ? 'text-red-400' : 'text-[#94a3b8]'}`}>
                  {ultimo.delta > 0 ? `+${ultimo.delta}` : ultimo.delta}
                </p>
                <p className="text-xs text-[#4a4a6a]">Desde el registro anterior</p>
              </div>
            </div>

            <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#C9477A]/10 border border-[#C9477A]/20 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9477A">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{formatFecha(ultimo.fecha)}</p>
                <p className="text-xs text-[#4a4a6a]">Último registro</p>
              </div>
            </div>
          </div>

          {/* Historial */}
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#4a4a6a] text-xs border-b border-[#2a2a3e] bg-[#0f0f1a]/40">
                  <th className="text-left px-4 py-3">Fecha</th>
                  <th className="text-right px-4 py-3">Total</th>
                  <th className="text-right px-4 py-3">Variación</th>
                  <th className="text-left px-4 py-3">Nota</th>
                  <th className="px-3 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r, i) => (
                  <tr key={r.id} className="border-b border-[#2a2a3e]/50 last:border-0 hover:bg-[#2a2a3e]/30 transition-colors group">
                    <td className="px-4 py-3 text-[#94a3b8] text-xs whitespace-nowrap">{formatFecha(r.fecha)}</td>
                    <td className="px-4 py-3 text-right font-bold text-foreground">{r.total.toLocaleString('es-ES')}</td>
                    <td className="px-4 py-3 text-right">
                      {i === registros.length - 1 ? (
                        <span className="text-xs text-[#4a4a6a]">—</span>
                      ) : (
                        <span className={`text-sm font-semibold ${r.delta > 0 ? 'text-emerald-400' : r.delta < 0 ? 'text-red-400' : 'text-[#94a3b8]'}`}>
                          {r.delta > 0 ? `+${r.delta}` : r.delta}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4a4a6a]">{r.nota || '—'}</td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => eliminar(r.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#4a4a6a] hover:text-red-400 transition-all"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/70" onClick={() => setModal(false)} />
          <div className="relative z-10 bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-foreground font-semibold text-base">Nuevo registro</h3>
              <button onClick={() => setModal(false)} className="p-1 text-[#4a4a6a] hover:text-[#94a3b8]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-[#4a4a6a] mb-5">
              Introduce el total actual. La variación se calcula automáticamente.
            </p>

            {ultimo && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-[#25d366]/5 border border-[#25d366]/15 text-xs text-[#4a4a6a]">
                Último: <span className="text-foreground font-semibold">{ultimo.total.toLocaleString('es-ES')} miembros</span>
                <span className="mx-1.5">·</span>
                <span>{formatFecha(ultimo.fecha)}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#94a3b8] mb-1.5 block">Total de miembros ahora *</label>
                <input
                  autoFocus
                  type="number"
                  min="0"
                  value={totalInput}
                  onChange={e => setTotalInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && guardar()}
                  placeholder="Ej: 234"
                  className="w-full bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl px-3 py-2.5 text-foreground text-sm placeholder-[#3a3a5e] focus:outline-none focus:border-[#25d366]/40 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-[#94a3b8] mb-1.5 block">Nota (opcional)</label>
                <input
                  type="text"
                  value={notaInput}
                  onChange={e => setNotaInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && guardar()}
                  placeholder="Ej: Tras publicar el reel del miércoles"
                  className="w-full bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl px-3 py-2.5 text-foreground text-sm placeholder-[#3a3a5e] focus:outline-none focus:border-[#25d366]/40 transition-colors"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setModal(false)}
                className="flex-1 px-4 py-2.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] rounded-xl text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={!totalInput || guardando}
                className="flex-1 px-4 py-2.5 bg-[#25d366]/15 hover:bg-[#25d366]/25 disabled:opacity-40 disabled:cursor-not-allowed text-[#25d366] rounded-xl text-sm transition-colors border border-[#25d366]/20 flex items-center justify-center gap-2"
              >
                {guardando && <div className="w-3.5 h-3.5 border-2 border-[#25d366]/30 border-t-[#25d366] rounded-full animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
