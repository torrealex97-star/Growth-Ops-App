"use client"

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Users, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContactsAllView } from '@/components/crm/ContactsAllView'
import { ContactsLeadsView } from '@/components/crm/ContactsLeadsView'

type ContactsView = 'all' | 'leads'

// Fusiona Contactos + Leads en una sola lista de personas, con un conmutador de vista.
// "Todos" es la lista simple de contactos; "Leads (VSL)" añade % de VSL visto, el filtro de
// leads calientes (≥75%) y el seguimiento por días — ambas vistas conservan el 100% de sus
// filtros/columnas/capacidades originales, solo comparten ahora una URL y un selector.
function ContactosPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view: ContactsView = searchParams.get('view') === 'leads' ? 'leads' : 'all'

  const setView = (v: ContactsView) => {
    const params = new URLSearchParams(searchParams.toString())
    if (v === 'all') params.delete('view')
    else params.set('view', v)
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?', { scroll: false })
  }

  return (
    <div className="space-y-6">
      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        <button
          onClick={() => setView('all')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
            view === 'all' ? 'bg-card text-foreground shadow' : 'hover:text-foreground'
          )}
        >
          <Users className="w-3.5 h-3.5" /> Todos
        </button>
        <button
          onClick={() => setView('leads')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
            view === 'leads' ? 'bg-card text-foreground shadow' : 'hover:text-foreground'
          )}
        >
          <PlayCircle className="w-3.5 h-3.5" /> Leads (VSL)
        </button>
      </div>

      {view === 'all' ? <ContactsAllView /> : <ContactsLeadsView />}
    </div>
  )
}

export default function ContactosPage() {
  return (
    <Suspense fallback={null}>
      <ContactosPageInner />
    </Suspense>
  )
}
