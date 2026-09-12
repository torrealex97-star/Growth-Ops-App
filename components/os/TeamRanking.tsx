'use client'

import { useState } from 'react'
import { Trophy, Medal } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { RankRow } from '@/lib/analytics'

const medalColor = ['text-amber-400', 'text-foreground', 'text-orange-400']

function RankList({ rows }: { rows: RankRow[] }) {
  const active = rows.filter((r) => r.sales > 0 || r.cash > 0)
  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Sin ventas registradas todavía.</p>
  }
  return (
    <div className="space-y-1">
      {active.map((r, i) => (
        <div
          key={r.userId}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors"
        >
          <div className="w-6 flex justify-center shrink-0">
            {i < 3 ? (
              <Medal className={`w-4 h-4 ${medalColor[i]}`} />
            ) : (
              <span className="text-xs text-muted-foreground font-medium">{i + 1}</span>
            )}
          </div>
          <span className="flex-1 min-w-0 truncate text-sm text-foreground">{r.name}</span>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-foreground">{formatCurrency(r.gross)}</p>
            <p className="text-[11px] text-muted-foreground">
              {r.sales} {r.sales === 1 ? 'venta' : 'ventas'} · {formatCurrency(r.cash)} cobrado
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function TeamRanking({ closers, setters }: { closers: RankRow[]; setters: RankRow[] }) {
  const [tab, setTab] = useState<'closer' | 'setter'>('closer')
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-foreground">Ranking del equipo</h3>
        </div>
        <div className="flex bg-muted rounded-lg p-0.5">
          {(['closer', 'setter'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                tab === t ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'closer' ? 'Closers' : 'Setters'}
            </button>
          ))}
        </div>
      </div>
      <RankList rows={tab === 'closer' ? closers : setters} />
    </div>
  )
}
