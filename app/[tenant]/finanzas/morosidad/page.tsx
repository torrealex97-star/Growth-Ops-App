'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InstallmentsMorosidadView } from '@/components/finanzas/InstallmentsMorosidadView'
import { SequraMorosidadView } from '@/components/finanzas/SequraMorosidadView'

type Origen = 'todas' | 'interno' | 'sequra'

const ORIGENES: { key: Origen; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'interno', label: 'Pagos a plazos (interno)' },
  { key: 'sequra', label: 'seQura' },
]

function MorosidadPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const origen: Origen = (['interno', 'sequra'].includes(searchParams.get('origen') || '')
    ? (searchParams.get('origen') as Origen)
    : 'todas')

  const setOrigen = (o: Origen) => {
    const params = new URLSearchParams(searchParams.toString())
    if (o === 'todas') params.delete('origen')
    else params.set('origen', o)
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?', { scroll: false })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-brand-400" /> Morosidad
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Pagos a plazos y financiados, internos y con seQura</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Origen</span>
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
            {ORIGENES.map((o) => (
              <button
                key={o.key}
                onClick={() => setOrigen(o.key)}
                className={cn(
                  'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                  origen === o.key ? 'bg-card text-foreground shadow' : 'hover:text-foreground'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </label>
      </div>

      {(origen === 'todas' || origen === 'interno') && <InstallmentsMorosidadView />}
      {(origen === 'todas' || origen === 'sequra') && <SequraMorosidadView />}
    </div>
  )
}

export default function MorosidadPage() {
  return (
    <Suspense fallback={null}>
      <MorosidadPageInner />
    </Suspense>
  )
}
