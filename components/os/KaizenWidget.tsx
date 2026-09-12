'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import type { SuggestionWithUser } from '@/lib/types/database'
import { useTenant } from '@/lib/tenant-context'

// Reconocimiento estilo Kaizen: cuantas más ideas/mejoras aporte cada uno, más visible se hace
// aquí. Un admin/director ve el ranking completo del equipo (la API les devuelve todas las
// sugerencias); un rep normal solo ve las suyas, así que aquí solo cuenta las propias.
export function KaizenWidget({ userId }: { userId: string }) {
  const tenant = useTenant()
  const [items, setItems] = useState<SuggestionWithUser[] | null>(null)

  useEffect(() => {
    fetch(`/api/${tenant}/evergreen/suggestions`)
      .then((r) => r.json())
      .then((d) => setItems(d.suggestions ?? []))
      .catch(() => setItems([]))
  }, [])

  if (!items) return null

  const myCount = items.filter((s) => s.user_id === userId).length

  const byUser = new Map<string, number>()
  for (const s of items) byUser.set(s.user_id ?? 'anon', (byUser.get(s.user_id ?? 'anon') ?? 0) + 1)
  const ranking = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1])
  const myRank = ranking.findIndex(([id]) => id === userId)
  const isTop = myRank === 0 && myCount > 0 && ranking.length > 1

  return (
    <Link
      href={`/${tenant}/settings/sugerencias`}
      className="block rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 mb-6 hover:border-brand-500/50 transition-colors"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-brand-400">
        <Sparkles className="w-4 h-4" /> Kaizen — mejora continua
      </div>
      <p className="text-sm text-foreground mt-1.5">
        Has aportado <span className="font-semibold">{myCount}</span> sugerencia{myCount === 1 ? '' : 's'} de mejora
        {ranking.length > 1 && myRank >= 0 && (
          <>
            {' '}
            · puesto <span className="font-semibold">#{myRank + 1}</span> del equipo
          </>
        )}
        .
      </p>
      {isTop && (
        <p className="text-xs text-emerald-400 mt-1">🏆 ¡Eres quien más aporta al equipo ahora mismo, sigue así!</p>
      )}
      {myCount === 0 && (
        <p className="text-xs text-muted-foreground mt-1">Toda idea cuenta — anima a tu equipo enviando la primera.</p>
      )}
    </Link>
  )
}
