'use client'

import type { AfiliadasStats } from '@/lib/types'

interface Props {
  stats: AfiliadasStats | null
  loading?: boolean
}

const MEDAL_COLORS = [
  { bg: 'bg-yellow-400/15', border: 'border-yellow-400/30', text: 'text-yellow-400', ring: 'ring-yellow-400/40' },
  { bg: 'bg-slate-400/15', border: 'border-slate-400/30', text: 'text-slate-300', ring: 'ring-slate-400/30' },
  { bg: 'bg-amber-600/15', border: 'border-amber-600/30', text: 'text-amber-500', ring: 'ring-amber-600/30' },
]

const MEDAL_LABELS = ['1º', '2º', '3º']

function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton rounded-xl ${className}`} />
}

export function Afiliadas({ stats, loading = false }: Props) {
  const top3 = stats?.ranking.slice(0, 3) ?? []
  const rest = stats?.ranking.slice(3) ?? []

  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">Afiliadas</h2>
        {!loading && stats && (
          <span className="text-xs text-[#94a3b8] bg-[#1a1a2e] border border-[#2a2a3e] px-2 py-0.5 rounded-full">
            {stats.totalLeadsAfiliadas} leads · {stats.pctOfTotal}% del total
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !stats || stats.ranking.length === 0 ? (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-8 text-center">
          <p className="text-[#4a4a6a] text-sm">Aún no hay leads de afiliadas registrados.</p>
          <p className="text-[#4a4a6a] text-xs mt-1">
            Se detectan automáticamente cuando utm_medium contiene &quot;Afiliación&quot;.
          </p>
        </div>
      ) : (
        <>
          {/* Podium top 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {top3.map((af, i) => {
              const medal = MEDAL_COLORS[i]
              const barWidth = top3[0].leads > 0 ? Math.round((af.leads / top3[0].leads) * 100) : 0
              return (
                <div
                  key={af.email}
                  className={`relative bg-[#1a1a2e] border ${medal.border} rounded-2xl p-5 overflow-hidden`}
                >
                  {/* position badge */}
                  <div className={`absolute top-4 right-4 w-7 h-7 rounded-full ${medal.bg} border ${medal.border} flex items-center justify-center`}>
                    <span className={`text-xs font-bold ${medal.text}`}>{MEDAL_LABELS[i]}</span>
                  </div>

                  {/* trophy icon for 1st */}
                  {i === 0 && (
                    <div className="mb-2">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-yellow-400">
                        <path d="M8 21h8m-4-4v4M12 3C7 3 5 7 5 9c0 2.5 2 4 4 5l3 1 3-1c2-1 4-2.5 4-5 0-2-2-6-7-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M5 9H3m0 0a2 2 0 002 2m16-2h-2m2 0a2 2 0 01-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                  )}

                  <p className="text-foreground font-semibold text-sm truncate pr-8" title={af.email}>
                    {af.nombre}
                  </p>
                  <p className="text-xs text-[#4a4a6a] truncate">{af.email}</p>
                  <p className={`text-2xl font-bold mt-1 ${medal.text}`}>{af.leads}</p>
                  <p className="text-xs text-[#94a3b8] mb-3">leads referidos</p>

                  {/* bar relative to 1st place */}
                  <div className="h-1.5 bg-[#2a2a3e] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-slate-400' : 'bg-amber-600'}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <p className="text-xs text-[#4a4a6a] mt-1">{af.pct}% de leads de afiliadas</p>
                </div>
              )
            })}
          </div>

          {/* Rest of ranking */}
          {rest.length > 0 && (
            <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#2a2a3e]">
                <p className="text-xs text-[#94a3b8] font-medium">Resto del ranking</p>
              </div>
              <div className="divide-y divide-[#2a2a3e]/50">
                {rest.map((af, i) => (
                  <div key={af.email} className="flex items-center gap-4 px-5 py-3 hover:bg-[#222238] transition-colors">
                    <span className="text-xs text-[#4a4a6a] w-6 text-right">{i + 4}º</span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm text-foreground block truncate" title={af.email}>{af.nombre}</span>
                      <span className="text-xs text-[#4a4a6a] block truncate">{af.email}</span>
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-1.5 bg-[#2a2a3e] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#C9477A]/60 rounded-full"
                          style={{ width: `${stats.ranking[0]?.leads > 0 ? Math.round((af.leads / stats.ranking[0].leads) * 100) : 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-[#C9477A] w-8 text-right">{af.leads}</span>
                      <span className="text-xs text-[#4a4a6a] w-8">{af.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
