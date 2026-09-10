'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  coldcaller_id: number; nombre: string; email: string
  total_asignados: number; llamadas_realizadas: number
  asisten: number; no_asisten: number; no_contesta: number; no_existe: number
}

const MEDAL = [
  { bg: 'bg-yellow-400/15', border: 'border-yellow-400/30', text: 'text-yellow-400', label: '1º' },
  { bg: 'bg-slate-400/15', border: 'border-slate-400/30', text: 'text-slate-300', label: '2º' },
  { bg: 'bg-amber-600/15', border: 'border-amber-600/30', text: 'text-amber-500', label: '3º' },
]

export function ColdCallingPodium() {
  const [stats, setStats] = useState<Stats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/coldcalling/admin/stats')
      .then((r) => r.json())
      .then((d) => { setStats(d.stats || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
          <h2 className="text-lg font-bold text-foreground">Cold Calling</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map((i) => <div key={i} className="h-28 rounded-2xl bg-[#1a1a2e] border border-[#2a2a3e] animate-pulse" />)}
        </div>
      </section>
    )
  }

  if (stats.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
          <h2 className="text-lg font-bold text-foreground">Cold Calling</h2>
          <Link href="/admin/coldcalling" className="ml-auto text-xs text-[#C9477A] hover:text-[#e05a8a] transition-colors">
            Gestionar →
          </Link>
        </div>
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6 text-center">
          <p className="text-[#4a4a6a] text-sm">Sin cold callers aún.</p>
          <Link href="/admin/coldcalling" className="inline-block mt-2 text-xs text-[#C9477A] hover:underline">Añadir cold callers →</Link>
        </div>
      </section>
    )
  }

  const totalAsisten = stats.reduce((s, c) => s + c.asisten, 0)
  const totalLlamadas = stats.reduce((s, c) => s + c.llamadas_realizadas, 0)
  const totalAsignados = stats.reduce((s, c) => s + c.total_asignados, 0)

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">Cold Calling</h2>
        <div className="flex gap-3 ml-2">
          <span className="text-xs text-[#94a3b8] bg-[#1a1a2e] border border-[#2a2a3e] px-2 py-0.5 rounded-full">
            {totalLlamadas} llamadas
          </span>
          <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            {totalAsisten} asisten
          </span>
        </div>
        <Link
          href="/admin/coldcalling"
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-[#C9477A]/15 hover:bg-[#C9477A]/25 border border-[#C9477A]/30 text-[#C9477A] hover:text-[#e05a8a] rounded-xl text-xs font-medium transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          Panel Cold Calling
        </Link>
      </div>

      {/* Podium top 3 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {stats.slice(0, 3).map((s, i) => {
          const medal = MEDAL[i]
          const tasaAsistencia = s.llamadas_realizadas > 0 ? Math.round((s.asisten / s.llamadas_realizadas) * 100) : 0
          const progreso = s.total_asignados > 0 ? Math.round((s.llamadas_realizadas / s.total_asignados) * 100) : 0
          return (
            <div key={s.coldcaller_id} className={`bg-[#1a1a2e] border ${medal.border} rounded-2xl p-4 relative`}>
              <div className={`absolute top-3 right-3 w-6 h-6 rounded-full ${medal.bg} border ${medal.border} flex items-center justify-center`}>
                <span className={`text-xs font-bold ${medal.text}`}>{medal.label}</span>
              </div>
              <p className={`text-xl font-bold ${medal.text}`}>{s.asisten}</p>
              <p className="text-foreground text-sm font-medium pr-8 truncate">{s.nombre}</p>
              <div className="mt-2 flex gap-3 text-xs">
                <span className="text-[#94a3b8]">{s.llamadas_realizadas} llamadas</span>
                <span className="text-emerald-400">{tasaAsistencia}% asistencia</span>
              </div>
              <div className="mt-2 h-1 bg-[#2a2a3e] rounded-full overflow-hidden">
                <div className="h-full bg-[#C9477A] rounded-full" style={{ width: `${progreso}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Full leaderboard table */}
      {stats.length > 0 && (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a3e]">
                <th className="text-left text-xs text-[#4a4a6a] font-medium px-4 py-3">#</th>
                <th className="text-left text-xs text-[#4a4a6a] font-medium px-4 py-3">Cold Caller</th>
                <th className="text-right text-xs text-[#4a4a6a] font-medium px-4 py-3">Asignados</th>
                <th className="text-right text-xs text-[#4a4a6a] font-medium px-4 py-3">Llamadas</th>
                <th className="text-right text-xs text-emerald-500 font-medium px-4 py-3">Asisten</th>
                <th className="text-right text-xs text-[#4a4a6a] font-medium px-4 py-3 hidden sm:table-cell">No contesta</th>
                <th className="text-right text-xs text-[#4a4a6a] font-medium px-4 py-3 hidden sm:table-cell">% Asist.</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => {
                const tasa = s.llamadas_realizadas > 0 ? Math.round((s.asisten / s.llamadas_realizadas) * 100) : 0
                return (
                  <tr key={s.coldcaller_id} className="border-b border-[#2a2a3e]/50 last:border-0 hover:bg-[#2a2a3e]/30 transition-colors">
                    <td className="px-4 py-3 text-[#4a4a6a] text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="text-foreground text-sm font-medium">{s.nombre}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-[#94a3b8] text-xs">{s.total_asignados}</td>
                    <td className="px-4 py-3 text-right text-[#94a3b8] text-xs">{s.llamadas_realizadas}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-emerald-400 font-semibold text-sm">{s.asisten}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-[#94a3b8] text-xs hidden sm:table-cell">{s.no_contesta}</td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className={`text-xs font-medium ${tasa >= 30 ? 'text-emerald-400' : tasa >= 15 ? 'text-yellow-400' : 'text-[#94a3b8]'}`}>
                        {tasa}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Coverage progress */}
      {totalAsignados > 0 && (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4">
          <div className="flex justify-between text-xs text-[#94a3b8] mb-2">
            <span>Cobertura total</span>
            <span>{totalLlamadas} de {totalAsignados} leads llamados ({Math.round((totalLlamadas / totalAsignados) * 100)}%)</span>
          </div>
          <div className="h-1.5 bg-[#2a2a3e] rounded-full overflow-hidden">
            <div className="h-full bg-[#C9477A] rounded-full" style={{ width: `${Math.round((totalLlamadas / totalAsignados) * 100)}%` }} />
          </div>
        </div>
      )}
    </section>
  )
}
