'use client'

import { Suspense } from 'react'
import { ContactsAllView } from '@/components/crm/ContactsAllView'

// Vista unificada de contactos: fusiona Contactos + Leads (VSL) en una sola tabla
// con filtros robustos, toggle de columnas y nombre formateado.
export default function ContactosPage() {
  return (
    <Suspense fallback={null}>
      <ContactsAllView />
    </Suspense>
  )
}
