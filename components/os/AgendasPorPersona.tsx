'use client'

import { useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import type { PersonaRow } from '@/lib/analytics-agendas'
import { formatNumber, formatPercent } from '@/lib/utils'

export type PersonaTab = 'closer' | 'setter' | 'collaborator'

const TAB_LABEL: Record<PersonaTab, string> = {
  closer: 'Closers',
  setter: 'Setters',
  collaborator: 'Colaboradores',
}

export function AgendasPorPersona({
  rows,
  persona,
  onPersonaChange,
  loading = false,
}: {
  rows: PersonaRow[]
  persona: PersonaTab
  onPersonaChange: (p: PersonaTab) => void
  loading?: boolean
}) {
  const withData = rows.filter((r) => r.total > 0)
  return (
    <div className="dashboard-card p-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-foreground">Agendas por persona</h3>
        </div>
        <div className="flex bg-muted rounded-lg p-0.5">
          {(['closer', 'setter', 'collaborator'] as PersonaTab[]).map((t) => (
            <button
              key={t}
              onClick={() => onPersonaChange(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                persona === t ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Cargando…</p>
      ) : withData.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sin agendas registradas todavía.</p>
      ) : (
        <div className="space-y-1">
          {withData.map((r) => (
            <div
              key={r.userId}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors"
            >
              <span className="flex-1 min-w-0 truncate text-sm text-foreground">{r.name}</span>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-foreground">
                  {formatNumber(r.total)} <span className="text-xs font-normal text-muted-foreground">agendas</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatNumber(r.shows)} asistieron · {formatNumber(r.noShows)} no asistieron ·{' '}
                  <span className={r.showRate >= 60 ? 'text-emerald-400' : 'text-muted-foreground'}>
                    {formatPercent(r.showRate, 0)} show
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
