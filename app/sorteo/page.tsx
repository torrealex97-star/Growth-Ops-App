'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { SORTEO_PARTICIPANTS } from '@/lib/sorteo-participants'

type Phase = 'idle' | 'countdown' | 'rolling' | 'revealed' | 'approved'

export default function SorteoPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [countdown, setCountdown] = useState(3)
  const [rollingName, setRollingName] = useState<string>('')
  const [winner, setWinner] = useState<string | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [approved, setApproved] = useState<string[]>([])
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup any timers on unmount
  useEffect(() => () => {
    if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
  }, [])

  const eligible = SORTEO_PARTICIPANTS.filter(p => !rejected.includes(p) && !approved.includes(p))
  // ref always points to the latest eligible — protects against stale closures
  // when reject() schedules a delayed re-sorteo via setTimeout
  const eligibleRef = useRef(eligible)
  useEffect(() => { eligibleRef.current = eligible }, [eligible])

  function startSorteo() {
    if (eligibleRef.current.length === 0) return
    if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    setWinner(null)
    setPhase('countdown')
    setCountdown(3)

    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
          startRolling()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  function startRolling() {
    setPhase('rolling')
    let ticks = 0
    const totalTicks = 28 // ~3.5s of rolling
    rollIntervalRef.current = setInterval(() => {
      ticks++
      const pool = eligibleRef.current
      if (pool.length === 0) {
        if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
        setPhase('idle')
        return
      }
      const random = pool[Math.floor(Math.random() * pool.length)]
      setRollingName(random)
      if (ticks >= totalTicks) {
        if (rollIntervalRef.current) clearInterval(rollIntervalRef.current)
        // Use crypto for the final pick — extra entropy
        const arr = new Uint32Array(1)
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          crypto.getRandomValues(arr)
        } else {
          arr[0] = Math.floor(Math.random() * 0xffffffff)
        }
        const finalIdx = arr[0] % pool.length
        const finalWinner = pool[finalIdx]
        setRollingName(finalWinner)
        setWinner(finalWinner)
        setPhase('revealed')
      }
    }, 100)
  }

  function approve() {
    if (!winner) return
    setApproved(prev => [...prev, winner])
    setPhase('approved')
  }

  function reject() {
    if (!winner) return
    setRejected(prev => [...prev, winner])
    setWinner(null)
    setRollingName('')
    setPhase('idle')
    // Auto-trigger next sorteo for fluidez
    setTimeout(() => startSorteo(), 400)
  }

  function reset() {
    setApproved([])
    setRejected([])
    setWinner(null)
    setRollingName('')
    setPhase('idle')
    setCountdown(3)
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex flex-col">
      <div className="h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />

      {/* Header */}
      <header className="bg-[#1a1a2e] border-b border-[#2a2a3e] sticky top-0 z-20">
        <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="w-8 h-8 rounded-lg bg-[#2a2a3e] hover:bg-[#3a3a5e] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <div className="w-9 h-9 rounded-xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center">
              <span className="text-lg">🎁</span>
            </div>
            <div>
              <h1 className="text-white font-bold text-base leading-tight">Sorteo · Viaje a París</h1>
              <p className="text-xs text-[#4a4a6a]">{SORTEO_PARTICIPANTS.length} participantes · {eligible.length} aún elegibles</p>
            </div>
          </div>
          <button onClick={reset} className="text-xs text-[#4a4a6a] hover:text-[#94a3b8] px-3 py-1.5 rounded-lg hover:bg-[#2a2a3e] transition-colors">
            Reiniciar
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-screen-lg mx-auto w-full px-4 sm:px-6 py-8 space-y-8">
        {/* Stage */}
        <section className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-3xl p-8 sm:p-12 min-h-[320px] flex flex-col items-center justify-center text-center">
          {phase === 'idle' && !winner && (
            <>
              <p className="text-[#94a3b8] text-sm mb-6">Pulsa el botón para sortear una ganadora</p>
              <button
                onClick={startSorteo}
                disabled={eligible.length === 0}
                className="px-8 py-4 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl text-base shadow-lg shadow-[#C9477A]/20 transition-all hover:scale-105"
              >
                🎲  Hacer sorteo
              </button>
              {eligible.length === 0 && (
                <p className="text-yellow-400 text-xs mt-4">No quedan participantes elegibles. Reinicia el sorteo.</p>
              )}
            </>
          )}

          {phase === 'countdown' && (
            <div className="flex flex-col items-center">
              <p className="text-[#94a3b8] text-sm mb-4">Sorteando…</p>
              <div className="text-7xl sm:text-9xl font-bold text-[#C9477A] tabular-nums animate-pulse">
                {countdown}
              </div>
            </div>
          )}

          {phase === 'rolling' && (
            <div className="flex flex-col items-center">
              <p className="text-[#94a3b8] text-sm mb-4">Eligiendo…</p>
              <div className="text-2xl sm:text-4xl font-bold text-white max-w-full break-words">
                {rollingName || '...'}
              </div>
            </div>
          )}

          {(phase === 'revealed' || phase === 'approved') && winner && (
            <div className="flex flex-col items-center w-full">
              <p className="text-[#94a3b8] text-xs uppercase tracking-widest mb-2">Ganadora</p>
              <div className={`text-3xl sm:text-5xl font-bold mb-6 break-words max-w-full ${phase === 'approved' ? 'text-emerald-400' : 'text-[#C9477A]'}`}>
                {winner}
              </div>
              {phase === 'revealed' && (
                <div className="flex gap-3 flex-wrap justify-center">
                  <button
                    onClick={approve}
                    className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl transition-colors"
                  >
                    ✓  Aprobar (cumple requisitos)
                  </button>
                  <button
                    onClick={reject}
                    className="px-6 py-3 bg-red-500/90 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors"
                  >
                    ✕  Rechazar y volver a sortear
                  </button>
                </div>
              )}
              {phase === 'approved' && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-emerald-400 text-sm">🎉 Ganadora confirmada</p>
                  <button
                    onClick={() => { setWinner(null); setPhase('idle') }}
                    className="px-5 py-2.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] hover:text-white rounded-xl text-sm transition-colors"
                  >
                    Sortear otra (premio adicional)
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* History */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-emerald-400 text-xs font-medium uppercase tracking-wider">Aprobadas</p>
              <span className="text-emerald-400 text-xs">{approved.length}</span>
            </div>
            {approved.length === 0 ? (
              <p className="text-[#4a4a6a] text-xs">Sin ganadoras aún</p>
            ) : (
              <ul className="space-y-1.5">
                {approved.map(name => (
                  <li key={name} className="text-sm text-white flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span className="truncate">{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-red-400 text-xs font-medium uppercase tracking-wider">Rechazadas</p>
              <span className="text-red-400 text-xs">{rejected.length}</span>
            </div>
            {rejected.length === 0 ? (
              <p className="text-[#4a4a6a] text-xs">Sin rechazos</p>
            ) : (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {rejected.map(name => (
                  <li key={name} className="text-sm text-[#94a3b8] flex items-center gap-2">
                    <span className="text-red-400">✕</span>
                    <span className="truncate">{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Participants list (collapsed by default) */}
        <details className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl">
          <summary className="cursor-pointer px-5 py-3 text-sm text-[#94a3b8] hover:text-white select-none">
            Ver lista completa de participantes ({SORTEO_PARTICIPANTS.length})
          </summary>
          <ul className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#94a3b8]">
            {SORTEO_PARTICIPANTS.map((p, i) => (
              <li key={p}>
                <span className="text-[#4a4a6a] mr-2">{(i + 1).toString().padStart(2, '0')}.</span>
                {p}
              </li>
            ))}
          </ul>
        </details>
      </main>

      <footer className="text-center pb-6 pt-2">
        <p className="text-[#2a2a3e] text-xs">IA WINNERS © 2026 — Sorteo Viaje a París</p>
      </footer>
    </div>
  )
}
