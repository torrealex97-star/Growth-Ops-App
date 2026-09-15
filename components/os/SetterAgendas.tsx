'use client'

import { CalendarCheck } from 'lucide-react'
import type { SetterAgendaRow } from '@/lib/analytics'

export function SetterAgendas({ rows }: { rows: SetterAgendaRow[] }) {
  const withData = rows.filter((r) => r.total > 0)
  return (
    <div className="dashboard-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <CalendarCheck className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Agendas por setter</h3>
      </div>
      {withData.length === 0 ? (
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
                  {r.total} <span className="text-xs font-normal text-muted-foreground">agendas</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {r.shows} shows · {r.noShows} no-show ·{' '}
                  <span className={r.showRate >= 60 ? 'text-emerald-400' : 'text-muted-foreground'}>
                    {r.showRate.toFixed(0)}% show
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
